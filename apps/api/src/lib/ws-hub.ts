import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerToDeviceMessage } from '@signage/shared';
import { CHANNEL_PREFIX, deviceChannel, getRedisPub, getRedisSub, orgChannel } from './redis';

interface HubEntry {
  socket: WebSocket;
  organizationId: string;
}

/**
 * Tracks WebSocket connections of devices connected to THIS api instance and
 * fans out messages across instances via Redis pub/sub, so any instance can
 * deliver a command to a device connected elsewhere.
 */
export class WsHub {
  private connections = new Map<string, HubEntry>();
  private started = false;

  constructor(private log: FastifyBaseLogger) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const sub = getRedisSub();
    await sub.psubscribe(`${CHANNEL_PREFIX}:*`);
    sub.on('pmessage', (_pattern, channel, message) => {
      try {
        this.routeRedisMessage(channel, message);
      } catch (err) {
        this.log.error({ err, channel }, 'ws-hub: failed to route redis message');
      }
    });
  }

  private routeRedisMessage(channel: string, message: string): void {
    const parsed = JSON.parse(message) as ServerToDeviceMessage;
    const deviceMatch = channel.match(new RegExp(`^${CHANNEL_PREFIX}:device:(.+)$`));
    if (deviceMatch) {
      this.sendLocal(deviceMatch[1], parsed);
      return;
    }
    const orgMatch = channel.match(new RegExp(`^${CHANNEL_PREFIX}:org:(.+)$`));
    if (orgMatch) {
      for (const [deviceId, entry] of this.connections) {
        if (entry.organizationId === orgMatch[1]) this.sendLocal(deviceId, parsed);
      }
    }
  }

  register(deviceId: string, organizationId: string, socket: WebSocket): void {
    const existing = this.connections.get(deviceId);
    if (existing && existing.socket !== socket) {
      try {
        existing.socket.close(4000, 'Replaced by a newer connection');
      } catch {
        /* ignore */
      }
    }
    this.connections.set(deviceId, { socket, organizationId });
    this.log.info({ deviceId }, 'device websocket connected');
  }

  unregister(deviceId: string, socket: WebSocket): void {
    const entry = this.connections.get(deviceId);
    if (entry && entry.socket === socket) {
      this.connections.delete(deviceId);
      this.log.info({ deviceId }, 'device websocket disconnected');
    }
  }

  isConnectedLocally(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  /** Sends to a locally connected device. Returns true if delivered. */
  sendLocal(deviceId: string, message: ServerToDeviceMessage): boolean {
    const entry = this.connections.get(deviceId);
    if (!entry || entry.socket.readyState !== entry.socket.OPEN) return false;
    entry.socket.send(JSON.stringify(message));
    return true;
  }

  /** Publishes to all instances; whichever holds the socket delivers. */
  async sendToDevice(deviceId: string, message: ServerToDeviceMessage): Promise<void> {
    await getRedisPub().publish(deviceChannel(deviceId), JSON.stringify(message));
  }

  /** Notifies every connected device of an organization. */
  async sendToOrg(organizationId: string, message: ServerToDeviceMessage): Promise<void> {
    await getRedisPub().publish(orgChannel(organizationId), JSON.stringify(message));
  }

  async notifySyncRequired(deviceIds: string[], reason: string): Promise<void> {
    await Promise.all(
      deviceIds.map((id) => this.sendToDevice(id, { type: 'sync_required', reason })),
    );
  }

  async notifyOrgSyncRequired(organizationId: string, reason: string): Promise<void> {
    await this.sendToOrg(organizationId, { type: 'sync_required', reason });
  }
}
