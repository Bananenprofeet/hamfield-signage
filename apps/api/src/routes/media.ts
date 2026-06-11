import { createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { mediaListQuerySchema, updateMediaSchema } from '@signage/shared';
import { mediaTypeForMime, sanitizeFilename, sniffMimeType } from '@signage/media';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, notFound } from '../lib/errors';
import { presignDownload, uploadFileToS3 } from '../lib/s3';
import { getMediaQueue } from '../lib/queues';
import { serializeMedia } from '../lib/serializers';
import type { MediaAsset } from '@signage/database';

type OrgParams = { Params: { orgId: string } };
type MediaParams = { Params: { orgId: string; mediaId: string } };

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

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  app.post<OrgParams>('/orgs/:orgId/media', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');

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
        { mediaId: asset.id, orgId: req.params.orgId, mime: sniffed, size: stat.size },
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

    const where = {
      organizationId: req.params.orgId,
      deletedAt: null,
      ...(query.type ? { mediaType: query.type } : {}),
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(query.status ? { processingStatus: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.mediaAsset.count({ where }),
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const serialized = await Promise.all(
      items.map(async (m) => serializeMedia(m, await mediaUrls(m))),
    );
    return { total, page: query.page, pageSize: query.pageSize, items: serialized };
  });

  app.get<MediaParams>('/orgs/:orgId/media/:mediaId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');
    return serializeMedia(media, await mediaUrls(media));
  });

  app.patch<MediaParams>('/orgs/:orgId/media/:mediaId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updateMediaSchema.parse(req.body);
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');
    const updated = await prisma.mediaAsset.update({
      where: { id: media.id },
      data: { name: body.name },
    });
    return serializeMedia(updated, await mediaUrls(updated));
  });

  app.delete<MediaParams>('/orgs/:orgId/media/:mediaId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const media = await prisma.mediaAsset.findFirst({
      where: { id: req.params.mediaId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!media) throw notFound('Media not found');

    await prisma.$transaction([
      prisma.mediaAsset.update({ where: { id: media.id }, data: { deletedAt: new Date() } }),
      prisma.playlistItem.deleteMany({ where: { mediaAssetId: media.id } }),
    ]);
    // Object storage cleanup is intentionally deferred (kept for restore /
    // audit); a retention job can purge soft-deleted media later.
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'media deleted');
    req.log.info({ mediaId: media.id }, 'media soft-deleted');
    return reply.status(204).send();
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
