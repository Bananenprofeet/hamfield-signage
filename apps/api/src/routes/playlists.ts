import type { FastifyInstance } from 'fastify';
import {
  createPlaylistSchema,
  replacePlaylistItemsSchema,
  updatePlaylistSchema,
} from '@signage/shared';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { presignDownload } from '../lib/s3';
import { serializePlaylist, serializePlaylistItem } from '../lib/serializers';

type OrgParams = { Params: { orgId: string } };
type PlaylistParams = { Params: { orgId: string; playlistId: string } };

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  async function assertMediaInOrg(orgId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const count = await prisma.mediaAsset.count({
      where: { id: { in: mediaIds }, organizationId: orgId, deletedAt: null },
    });
    if (count !== new Set(mediaIds).size) {
      throw badRequest('One or more media items do not exist in this organization');
    }
  }

  app.get<OrgParams>('/orgs/:orgId/playlists', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const playlists = await prisma.playlist.findMany({
      where: { organizationId: req.params.orgId, deletedAt: null },
      include: {
        _count: { select: { items: true } },
        items: { include: { mediaAsset: true } },
      },
      orderBy: { name: 'asc' },
    });
    return playlists.map((p) => serializePlaylist(p));
  });

  app.post<OrgParams>('/orgs/:orgId/playlists', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = createPlaylistSchema.parse(req.body);
    await assertMediaInOrg(req.params.orgId, body.items?.map((i) => i.mediaAssetId) ?? []);

    const playlist = await prisma.playlist.create({
      data: {
        organizationId: req.params.orgId,
        name: body.name,
        description: body.description,
        loop: body.loop,
        defaultImageDurationSeconds: body.defaultImageDurationSeconds,
        items: body.items?.length
          ? {
              create: body.items.map((item, index) => ({
                mediaAssetId: item.mediaAssetId,
                position: index,
                durationSeconds: item.durationSeconds,
                fitMode: item.fitMode,
                enabled: item.enabled,
              })),
            }
          : undefined,
      },
      include: { items: { include: { mediaAsset: true } }, _count: { select: { items: true } } },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist created');
    return reply.status(201).send(serializePlaylist(playlist, { includeItems: true }));
  });

  app.get<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
      include: {
        items: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
        _count: { select: { items: true } },
      },
    });
    if (!playlist) throw notFound('Playlist not found');

    const dto = serializePlaylist(playlist, { includeItems: true });
    // Attach thumbnails for the editor UI.
    if (dto.items) {
      dto.items = await Promise.all(
        playlist.items.map(async (item) =>
          serializePlaylistItem(item, {
            thumbnailUrl: item.mediaAsset.thumbnailStorageKey
              ? await presignDownload(item.mediaAsset.thumbnailStorageKey)
              : null,
          }),
        ),
      );
    }
    return dto;
  });

  app.patch<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updatePlaylistSchema.parse(req.body);
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');

    const updated = await prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        name: body.name,
        description: body.description,
        loop: body.loop,
        defaultImageDurationSeconds: body.defaultImageDurationSeconds,
      },
      include: { items: { include: { mediaAsset: true } }, _count: { select: { items: true } } },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist updated');
    return serializePlaylist(updated, { includeItems: true });
  });

  app.put<PlaylistParams>('/orgs/:orgId/playlists/:playlistId/items', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = replacePlaylistItemsSchema.parse(req.body);
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');
    await assertMediaInOrg(
      req.params.orgId,
      body.items.map((i) => i.mediaAssetId),
    );

    const updated = await prisma.$transaction(async (tx) => {
      await tx.playlistItem.deleteMany({ where: { playlistId: playlist.id } });
      if (body.items.length > 0) {
        await tx.playlistItem.createMany({
          data: body.items.map((item, index) => ({
            playlistId: playlist.id,
            mediaAssetId: item.mediaAssetId,
            position: index,
            durationSeconds: item.durationSeconds,
            fitMode: item.fitMode,
            enabled: item.enabled,
          })),
        });
      }
      return tx.playlist.findUniqueOrThrow({
        where: { id: playlist.id },
        include: {
          items: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
          _count: { select: { items: true } },
        },
      });
    });

    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist items updated');
    return serializePlaylist(updated, { includeItems: true });
  });

  app.delete<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');

    const usedBySchedules = await prisma.schedule.count({
      where: { playlistId: playlist.id, deletedAt: null },
    });
    if (usedBySchedules > 0) {
      throw conflict('Playlist is used by one or more schedules; remove those first');
    }
    const usedAsDefault = await prisma.device.count({
      where: { defaultPlaylistId: playlist.id, deletedAt: null },
    });
    if (usedAsDefault > 0) {
      throw conflict('Playlist is the default playlist of one or more devices');
    }

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { deletedAt: new Date() },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist deleted');
    return reply.status(204).send();
  });
}
