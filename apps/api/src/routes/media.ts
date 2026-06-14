import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bulkDeleteMediaSchema,
  bulkMoveMediaSchema,
  mediaListQuerySchema,
  updateMediaSchema,
  type MediaPlaybackStatsDto,
} from '@signage/shared';
import { mediaTypeForMime, sanitizeFilename, sniffMimeType } from '@signage/media';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, notFound } from '../lib/errors';
import { presignDownload, uploadFileToS3 } from '../lib/s3';
import { getMediaQueue } from '../lib/queues';
import { writeAudit } from '../lib/audit';
import { computeFolderPaths, loadFolders } from '../lib/folders';
import { computeMediaUsage } from '../lib/usage';
import { serializeMedia } from '../lib/serializers';
import type { MediaAsset, Prisma, PrismaClient } from '@signage/database';

type OrgParams = { Params: { orgId: string } };
type MediaParams = { Params: { orgId: string; mediaId: string } };

const uploadQuerySchema = z.object({ folderId: z.string().optional() });

async function mediaUrls(media: MediaAsset) {
  return {
    thumbnailUrl: media.thumbnailStorageKey
      ? await presignDownload(media.thumbnailStorageKey)
      : null,
    previewUrl: media.processedStorageKey
      ? await presignDownload(media.processedStorageKey)
      : media.processingStatus === 'ready'
        ? await presignDownload(media.originalStorageKey)
        : null,
  };
}

/** Total plays (start events) and last play per media id. */
async function playStatsFor(
  prisma: PrismaClient,
  mediaIds: string[],
): Promise<Map<string, { playCount: number; lastPlayedAt: string | null }>> {
  if (mediaIds.length === 0) return new Map();
  const grouped = await prisma.playbackEvent.groupBy({
    by: ['mediaAssetId'],
    where: { mediaAssetId: { in: mediaIds }, eventType: 'start' },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  return new Map(
    grouped
      .filter((g) => g.mediaAssetId != null)
      .map((g) => [
        g.mediaAssetId!,
        {
          playCount: g._count._all,
          lastPlayedAt: g._max.occurredAt ? g._max.occurredAt.toISOString() : null,
        },
      ]),
  );
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  async function assertFolderInOrg(orgId: string, folderId: string): Promise<void> {
    const folder = await prisma.mediaFolder.findFirst({
      where: { id: folderId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!folder) throw notFound('Folder not found');
  }

  app.post<OrgParams>('/orgs/:orgId/media', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const query = uploadQuerySchema.parse(req.query);
    const folderId = query.folderId || null;
    if (folderId) await assertFolderInOrg(req.params.orgId, folderId);

    const file = await req.file();
    if (!file) throw badRequest('No file uploaded (expected multipart field "file")');

    const tmpDir = await mkdtemp(join(tmpdir(), 'signage-upload-'));
    const tmpPath = join(tmpDir, 'upload.bin');
    try {
      await pipeline(file.file, createWriteStream(tmpPath));
      if (file.file.truncated) {
        throw badRequest('File exceeds the maximum allowed upload size');
      }

      // Validate by magic bytes — never trust the client MIME type.
      const fh = await open(tmpPath, 'r');
      const head = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(head, 0, head.length, 0);
      const stat = await fh.stat();
      await fh.close();

      const sniffed = sniffMimeType(head.subarray(0, bytesRead));
      if (!sniffed) {
        throw badRequest('Unsupported or unrecognized file format');
      }
      const mediaType = mediaTypeForMime(sniffed);
      if (!mediaType) {
        throw badRequest(`Unsupported media type: ${sniffed}`);
      }

      const safeName = sanitizeFilename(file.filename || 'upload');
      const assetId = randomUUID();
      const storageKey = `org/${req.params.orgId}/media/${assetId}/original/${safeName}`;

      await uploadFileToS3(storageKey, tmpPath, sniffed);

      const asset = await prisma.mediaAsset.create({
        data: {
          id: assetId,
          organizationId: req.params.orgId,
          folderId,
          name: safeName.replace(/\.[^.]+$/, '') || safeName,
          originalFilename: safeName,
          mediaType,
          originalMimeType: sniffed,
          originalStorageKey: storageKey,
          sizeBytes: BigInt(stat.size),
          processingStatus: 'pending',
        },
      });
      const job = await prisma.mediaProcessingJob.create({
        data: { mediaAssetId: asset.id, status: 'queued' },
      });
      await getMediaQueue().add('process', { mediaAssetId: asset.id, jobRecordId: job.id });

      req.log.info(
        { mediaId: asset.id, orgId: req.params.orgId, mime: sniffed, size: stat.size, folderId },
        'media uploaded, processing queued',
      );
      return await reply.status(201).send(serializeMedia(asset));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  app.get<OrgParams>('/orgs/:orgId/media', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const query = mediaListQuerySchema.parse(req.query);

    const where: Prisma.MediaAssetWhereInput = {
      organizationId: req.params.orgId,
      deletedAt: null,
      ...(query.type ? { mediaType: query.type } : {}),
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(query.status ? { processingStatus: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      // 'root' = unfiled media; a folder id = that folder only; absent = all.
      ...(query.folderId === 'root'
        ? { folderId: null }
        : query.folderId
          ? { folderId: query.folderId }
          : {}),
      ...(query.usedInPlaylist === true
        ? { playlistItems: { some: { playlist: { deletedAt: null } } } }
        : query.usedInPlaylist === false
          ? { playlistItems: { none: { playlist: { deletedAt: null } } } }
          : {}),
    };

    const include = {
      _count: {
        select: { playlistItems: { where: { playlist: { deletedAt: null } } } },
      },
    } satisfies Prisma.MediaAssetInclude;

    let total: number;
    let items: (MediaAsset & { _count: { playlistItems: number } })[];

    if (query.sort === 'playCount') {
      // Play count lives in playback_events; sort ids in memory, then page.
      const all = await prisma.mediaAsset.findMany({ where, select: { id: true } });
      const stats = await playStatsFor(
        prisma,
        all.map((m) => m.id),
      );
      const sortedIds = all
        .map((m) => m.id)
        .sort((a, b) => {
          const diff = (stats.get(a)?.playCount ?? 0) - (stats.get(b)?.playCount ?? 0);
          return query.order === 'asc' ? diff : -diff;
        });
      total = sortedIds.length;
      const pageIds = sortedIds.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      );
      const rows = await prisma.mediaAsset.findMany({ where: { id: { in: pageIds } }, include });
      const byId = new Map(rows.map((r) => [r.id, r]));
      items = pageIds.map((id) => byId.get(id)!).filter(Boolean);
    } else {
      const orderField = (
        {
          name: 'name',
          createdAt: 'createdAt',
          updatedAt: 'updatedAt',
          type: 'mediaType',
          orientation: 'orientation',
          duration: 'durationSeconds',
        } as const
      )[query.sort];
      [total, items] = await Promise.all([
        prisma.mediaAsset.count({ where }),
        prisma.mediaAsset.findMany({
          where,
          include,
          orderBy: [
            { [orderField]: query.order } as Prisma.MediaAssetOrderByWithRelationInput,
            { id: 'asc' },
          ],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
    }

    const folderPaths = computeFolderPaths(await loadFolders(prisma, req.params.orgId));
    const stats = await playStatsFor(
      prisma,
      items.map((m) => m.id),
    );

    const serialized = await Promise.all(
      items.map(async (m) =>
        serializeMedia(m, await mediaUrls(m), {
          folderPath: m.folderId ? (folderPaths.get(m.folderId) ?? null) : null,
          playCount: stats.get(m.id)?.playCount ?? 0,
          lastPlayedAt: stats.get(m.id)?.lastPlayedAt ?? null,
          usedInPlaylistCount: m._count.playlistItems,
        }),
      ),
    );
    return { total, page: query.page, pageSize: query.pageSize, items: serialized };
  });

  app.get<MediaParams>('/orgs/:orgId/media/:mediaId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');
    const stats = await playStatsFor(prisma, [media.id]);
    const folderPaths = media.folderId
      ? computeFolderPaths(await loadFolders(prisma, req.params.orgId))
      : null;
    return serializeMedia(media, await mediaUrls(media), {
      folderPath: media.folderId ? (folderPaths?.get(media.folderId) ?? null) : null,
      playCount: stats.get(media.id)?.playCount ?? 0,
      lastPlayedAt: stats.get(media.id)?.lastPlayedAt ?? null,
    });
  });

  // Rename and/or move to another folder.
  app.patch<MediaParams>('/orgs/:orgId/media/:mediaId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updateMediaSchema.parse(req.body);
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');
    if (body.folderId) await assertFolderInOrg(req.params.orgId, body.folderId);

    const updated = await prisma.mediaAsset.update({
      where: { id: media.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      },
    });
    if (body.folderId !== undefined && body.folderId !== media.folderId) {
      // Folder membership feeds dynamic playlist entries.
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'media moved');
    }
    return serializeMedia(updated, await mediaUrls(updated));
  });

  app.post<OrgParams>('/orgs/:orgId/media/bulk-move', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = bulkMoveMediaSchema.parse(req.body);
    if (body.folderId) await assertFolderInOrg(req.params.orgId, body.folderId);

    const result = await prisma.mediaAsset.updateMany({
      where: { id: { in: body.mediaIds }, organizationId: req.params.orgId, deletedAt: null },
      data: { folderId: body.folderId },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'media moved');
    return { moved: result.count };
  });

  // Safe-delete information shown in the confirmation dialog.
  app.get<MediaParams>('/orgs/:orgId/media/:mediaId/usage', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');
    return computeMediaUsage(prisma, media);
  });

  app.get<MediaParams>('/orgs/:orgId/media/:mediaId/playback-stats', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');

    const [totals, perDevice, perPlaylist] = await Promise.all([
      prisma.playbackEvent.aggregate({
        where: { mediaAssetId: media.id, eventType: 'start' },
        _count: { _all: true },
        _min: { occurredAt: true },
        _max: { occurredAt: true },
      }),
      prisma.playbackEvent.groupBy({
        by: ['deviceId'],
        where: { mediaAssetId: media.id, eventType: 'start' },
        _count: { _all: true },
        _max: { occurredAt: true },
        orderBy: { _max: { occurredAt: 'desc' } },
        take: 10,
      }),
      prisma.playbackEvent.groupBy({
        by: ['playlistId'],
        where: { mediaAssetId: media.id, eventType: 'start', playlistId: { not: null } },
        _count: { _all: true },
        _max: { occurredAt: true },
        orderBy: { _max: { occurredAt: 'desc' } },
        take: 10,
      }),
    ]);

    const [devices, playlists] = await Promise.all([
      prisma.device.findMany({
        where: { id: { in: perDevice.map((d) => d.deviceId) } },
        select: { id: true, name: true },
      }),
      prisma.playlist.findMany({
        where: { id: { in: perPlaylist.map((p) => p.playlistId!).filter(Boolean) } },
        select: { id: true, name: true },
      }),
    ]);
    const deviceNames = new Map(devices.map((d) => [d.id, d.name]));
    const playlistNames = new Map(playlists.map((p) => [p.id, p.name]));

    const stats: MediaPlaybackStatsDto = {
      totalPlayCount: totals._count._all,
      firstPlayedAt: totals._min.occurredAt ? totals._min.occurredAt.toISOString() : null,
      lastPlayedAt: totals._max.occurredAt ? totals._max.occurredAt.toISOString() : null,
      perDevice: perDevice.map((d) => ({
        deviceId: d.deviceId,
        deviceName: deviceNames.get(d.deviceId) ?? d.deviceId,
        playCount: d._count._all,
        lastPlayedAt: d._max.occurredAt?.toISOString() ?? '',
      })),
      perPlaylist: perPlaylist.map((p) => ({
        playlistId: p.playlistId!,
        playlistName: playlistNames.get(p.playlistId!) ?? p.playlistId!,
        playCount: p._count._all,
        lastPlayedAt: p._max.occurredAt?.toISOString() ?? '',
      })),
    };
    return stats;
  });

  async function softDeleteMedia(mediaIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.mediaAsset.updateMany({
        where: { id: { in: mediaIds } },
        data: { deletedAt: new Date() },
      }),
      prisma.playlistItem.deleteMany({ where: { mediaAssetId: { in: mediaIds } } }),
      prisma.playlistPriorityRuleAssignment.deleteMany({
        where: { mediaAssetId: { in: mediaIds } },
      }),
    ]);
    // Object storage cleanup is intentionally deferred (kept for restore /
    // audit); a retention job can purge soft-deleted media later.
  }

  app.delete<MediaParams>('/orgs/:orgId/media/:mediaId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');

    await softDeleteMedia([media.id]);
    await writeAudit(prisma, req, {
      action: 'media.delete',
      targetType: 'media_asset',
      targetId: media.id,
      organizationId: req.params.orgId,
      metadata: { name: media.name },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'media deleted');
    req.log.info({ mediaId: media.id }, 'media soft-deleted');
    return reply.status(204).send();
  });

  app.post<OrgParams>('/orgs/:orgId/media/bulk-delete', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = bulkDeleteMediaSchema.parse(req.body);
    const owned = await prisma.mediaAsset.findMany({
      where: { id: { in: body.mediaIds }, organizationId: req.params.orgId, deletedAt: null },
      select: { id: true },
    });
    const ids = owned.map((m) => m.id);
    if (ids.length > 0) {
      await softDeleteMedia(ids);
      await writeAudit(prisma, req, {
        action: 'media.bulk_delete',
        targetType: 'media_asset',
        organizationId: req.params.orgId,
        metadata: { count: ids.length },
      });
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'media deleted');
    }
    return { deleted: ids.length };
  });

  app.post<MediaParams>('/orgs/:orgId/media/:mediaId/reprocess', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');

    const updated = await prisma.mediaAsset.update({
      where: { id: media.id },
      data: { processingStatus: 'pending', processingError: null },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: { mediaAssetId: media.id, status: 'queued' },
    });
    await getMediaQueue().add('process', { mediaAssetId: media.id, jobRecordId: job.id });
    req.log.info({ mediaId: media.id }, 'media reprocess queued');
    return serializeMedia(updated);
  });
}
