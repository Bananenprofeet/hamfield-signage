import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  heartbeatSchema,
  type CommandType,
  type DeviceToServerMessage,
  type ServerToDeviceMessage,
} from '@signage/shared';
import type { Device, Prisma, PrismaClient } from '@signage/database';
import { applyHeartbeat } from '../lib/heartbeat';
import { buildSyncManifest } from '../lib/manifest';

function send(socket: WebSocket, message: ServerToDeviceMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

async function deliverPendingCommands(
  prisma: PrismaClient,
  deviceId: string,
  socket: WebSocket,
): Promise<void> {
  const now = new Date();
  const commands = await prisma.deviceCommand.findMany({
    where: {
      deviceId,
      status: { in: ['pending', 'sent'] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  for (const command of commands) {
    send(socket, {
      type: 'command',
      command: {
        id: command.id,
        type: command.type as CommandType,
        payload: (command.payload ?? {}) as Record<string, unknown>,
      },
    });
  }
  const pendingIds = commands.filter((c) => c.status === 'pending').map((c) => c.id);
  if (pendingIds.length > 0) {
    await prisma.deviceCommand.updateMany({
      where: { id: { in: pendingIds }, status: 'pending' },
      data: { status: 'sent', sentAt: now },
    });
  }
}

export async function deviceWsRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;

  app.get(
    '/device/ws',
    { websocket: true, preHandler: app.deviceAuth },
    (socket: WebSocket, req) => {
      const device = req.device as Device;
      const log = req.log.child({ deviceId: device.id });

      wsHub.register(device.id, device.organizationId, socket);

      void (async () => {
        try {
          await prisma.device.update({
            where: { id: device.id },
            data: { lastSeenAt: new Date(), lastIp: req.ip },
          });
          await deliverPendingCommands(prisma, device.id, socket);
        } catch (err) {
          log.error({ err }, 'ws: connect bookkeeping failed');
        }
      })();

      async function handleMessage(message: DeviceToServerMessage): Promise<void> {
        switch (message.type) {
          case 'hello': {
            await prisma.device.update({
              where: { id: device.id },
              data: { lastSeenAt: new Date(), appVersion: message.appVersion },
            });
            const manifest = await buildSyncManifest(prisma, device.id);
            send(socket, {
              type: 'hello_ack',
              serverTime: new Date().toISOString(),
              manifestVersion: manifest.version,
            });
            if (message.manifestVersion !== manifest.version) {
              send(socket, { type: 'sync_required', reason: 'content changed while offline' });
            }
            return;
          }
          case 'heartbeat': {
            const body = heartbeatSchema.parse(message.payload);
            await applyHeartbeat(prisma, device.id, body, req.ip);
            send(socket, { type: 'pong' });
            return;
          }
          case 'command_ack': {
            await prisma.deviceCommand.updateMany({
              where: {
                id: message.commandId,
                deviceId: device.id,
                status: { in: ['pending', 'sent'] },
              },
              data: { status: 'acked', ackedAt: new Date() },
            });
            return;
          }
          case 'command_result': {
            await prisma.deviceCommand.updateMany({
              where: {
                id: message.commandId,
                deviceId: device.id,
                status: { in: ['pending', 'sent', 'acked'] },
              },
              data: {
                status: message.status,
                result: (message.result ?? undefined) as Prisma.InputJsonValue | undefined,
                completedAt: new Date(),
              },
            });
            return;
          }
          case 'status': {
            await prisma.device.update({
              where: { id: device.id },
              data: {
                lastSeenAt: new Date(),
                currentPlaylistId: message.currentPlaylistId,
                currentMediaId: message.currentMediaId,
                manifestVersion: message.manifestVersion,
              },
            });
            return;
          }
        }
      }

      socket.on('message', (raw) => {
        let parsed: DeviceToServerMessage;
        try {
          parsed = JSON.parse(raw.toString()) as DeviceToServerMessage;
        } catch {
          log.warn('ws: received invalid JSON');
          return;
        }
        handleMessage(parsed).catch((err) => {
          log.warn({ err, type: parsed.type }, 'ws: failed to handle message');
        });
      });

      socket.on('error', (err) => {
        log.warn({ err }, 'ws: socket error');
      });

      socket.on('close', () => {
        wsHub.unregister(device.id, socket);
        prisma.device
          .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
          .catch(() => {
            /* best effort */
          });
      });
    },
  );
}
