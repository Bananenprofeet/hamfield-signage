import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { MediaAsset, PrismaClient } from '@signage/database';
import {
  buildThumbnailArgs,
  buildTranscodeArgs,
  probeMediaFile,
  runFfmpeg,
  sha256File,
  type ProbeResult,
} from '@signage/media';
import { getEnv } from './env';
import { downloadFromS3, uploadFileToS3 } from './s3';

export interface MediaJobData {
  mediaAssetId: string;
  jobRecordId: string;
}

export interface ProcessOutcome {
  organizationId: string;
  mediaAssetId: string;
}

function thumbnailSeekSeconds(probe: ProbeResult): number {
  if (probe.durationSeconds == null) return 1;
  // 10% in, clamped: avoids black lead-in frames without seeking past short clips.
  return Math.min(Math.max(probe.durationSeconds * 0.1, 0.5), 10);
}

async function processVideo(
  prisma: PrismaClient,
  media: MediaAsset,
  originalPath: string,
  tmpDir: string,
  baseKey: string,
  log: Logger,
): Promise<{ processedKey: string; processedMime: string; processedPath: string }> {
  const env = getEnv();
  const processedPath = join(tmpDir, 'processed.mp4');

  await runFfmpeg(
    buildTranscodeArgs({
      inputPath: originalPath,
      outputPath: processedPath,
      maxHeight: env.MAX_VIDEO_HEIGHT,
      videoBitrateKbps: env.VIDEO_BITRATE_KBPS,
    }),
  );
  const processedKey = `${baseKey}/processed/video.mp4`;
  await uploadFileToS3(processedKey, processedPath, 'video/mp4');
  log.info({ mediaId: media.id }, 'worker: main transcode uploaded');

  if (env.CREATE_FALLBACK_VARIANT) {
    const fallbackPath = join(tmpDir, 'fallback.mp4');
    await runFfmpeg(
      buildTranscodeArgs({
        inputPath: originalPath,
        outputPath: fallbackPath,
        maxHeight: Math.min(720, env.MAX_VIDEO_HEIGHT),
        videoBitrateKbps: env.FALLBACK_VIDEO_BITRATE_KBPS,
      }),
    );
    const fallbackKey = `${baseKey}/processed/video-fallback.mp4`;
    await uploadFileToS3(fallbackKey, fallbackPath, 'video/mp4');

    const fallbackProbe = await probeMediaFile(fallbackPath);
    const fallbackStat = await stat(fallbackPath);
    const fallbackChecksum = await sha256File(fallbackPath);
    const fallbackFields = {
      storageKey: fallbackKey,
      width: fallbackProbe.width,
      height: fallbackProbe.height,
      bitrateKbps: env.FALLBACK_VIDEO_BITRATE_KBPS,
      sizeBytes: BigInt(fallbackStat.size),
      checksumSha256: fallbackChecksum,
    };
    await prisma.mediaVariant.upsert({
      where: { mediaAssetId_kind: { mediaAssetId: media.id, kind: 'fallback' } },
      create: {
        mediaAssetId: media.id,
        kind: 'fallback',
        mimeType: 'video/mp4',
        ...fallbackFields,
      },
      update: fallbackFields,
    });
    log.info({ mediaId: media.id }, 'worker: fallback variant uploaded');
  }

  return { processedKey, processedMime: 'video/mp4', processedPath };
}

/**
 * Full pipeline for one uploaded asset: probe -> (transcode) -> thumbnail ->
 * checksum -> mark ready. Throws on failure so BullMQ can retry; every
 * attempt resets the asset to `processing` first.
 */
export async function processMediaAsset(
  prisma: PrismaClient,
  data: MediaJobData,
  log: Logger,
): Promise<ProcessOutcome | null> {
  const env = getEnv();
  const media = await prisma.mediaAsset.findUnique({ where: { id: data.mediaAssetId } });
  if (!media || media.deletedAt) {
    log.warn({ mediaId: data.mediaAssetId }, 'worker: media missing or deleted, skipping');
    await prisma.mediaProcessingJob
      .update({
        where: { id: data.jobRecordId },
        data: { status: 'failed', error: 'media asset missing or deleted', finishedAt: new Date() },
      })
      .catch(() => undefined);
    return null;
  }

  await prisma.mediaAsset.update({
    where: { id: media.id },
    data: { processingStatus: 'processing', processingError: null },
  });
  await prisma.mediaProcessingJob.update({
    where: { id: data.jobRecordId },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });

  const tmpDir = await mkdtemp(join(tmpdir(), 'signage-worker-'));
  try {
    const originalPath = join(tmpDir, 'original');
    await downloadFromS3(media.originalStorageKey, originalPath);
    const probe = await probeMediaFile(originalPath);

    const baseKey = `org/${media.organizationId}/media/${media.id}`;
    const isVideo = media.mediaType === 'video';

    const { processedKey, processedMime, processedPath } = isVideo
      ? await processVideo(prisma, media, originalPath, tmpDir, baseKey, log)
      : // Images are already playable; the original doubles as the processed file.
        {
          processedKey: media.originalStorageKey,
          processedMime: media.originalMimeType,
          processedPath: originalPath,
        };

    const thumbPath = join(tmpDir, 'thumb.jpg');
    await runFfmpeg(
      buildThumbnailArgs({
        inputPath: originalPath,
        outputPath: thumbPath,
        maxDimension: env.THUMBNAIL_MAX_DIMENSION,
        isVideo,
        seekSeconds: isVideo ? thumbnailSeekSeconds(probe) : undefined,
      }),
    );
    const thumbnailKey = `${baseKey}/thumb/thumb.jpg`;
    await uploadFileToS3(thumbnailKey, thumbPath, 'image/jpeg');

    const processedStat = await stat(processedPath);
    const checksum = await sha256File(processedPath);
    const durationSeconds = isVideo
      ? ((await probeMediaFile(processedPath)).durationSeconds ?? probe.durationSeconds)
      : null;

    await prisma.mediaAsset.update({
      where: { id: media.id },
      data: {
        width: probe.width,
        height: probe.height,
        orientation: probe.orientation,
        durationSeconds,
        processedStorageKey: processedKey,
        processedMimeType: processedMime,
        processedSizeBytes: BigInt(processedStat.size),
        checksumSha256: checksum,
        thumbnailStorageKey: thumbnailKey,
        processingStatus: 'ready',
        processingError: null,
      },
    });
    await prisma.mediaProcessingJob.update({
      where: { id: data.jobRecordId },
      data: { status: 'completed', error: null, finishedAt: new Date() },
    });

    log.info(
      {
        mediaId: media.id,
        orientation: probe.orientation,
        width: probe.width,
        height: probe.height,
        durationSeconds,
      },
      'worker: media ready',
    );
    return { organizationId: media.organizationId, mediaAssetId: media.id };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    log.error({ err, mediaId: media.id }, 'worker: processing failed');
    await prisma.mediaAsset
      .update({
        where: { id: media.id },
        data: { processingStatus: 'failed', processingError: message },
      })
      .catch(() => undefined);
    await prisma.mediaProcessingJob
      .update({
        where: { id: data.jobRecordId },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      })
      .catch(() => undefined);
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
