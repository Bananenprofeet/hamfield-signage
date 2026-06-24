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
  tierTranscodeOptions,
  VIDEO_TIERS,
  type ProbeResult,
} from '@signage/media';
import {
  DEFAULT_PLAYBACK_PROFILE,
  videoVariantKindForProfile,
  type PlaybackProfile,
} from '@signage/shared';
import { getEnv } from './env';
import { downloadFromS3, uploadFileToS3 } from './s3';

/**
 * The set of tiers to generate for one org's media: every distinct
 * `Device.playbackProfile` in use, plus the `standard` tier always (it is the
 * processed file every device falls back to). Generating only in-use tiers
 * keeps R2 storage minimal.
 */
async function tiersInUse(
  prisma: PrismaClient,
  organizationId: string,
): Promise<PlaybackProfile[]> {
  const rows = await prisma.device.findMany({
    where: { organizationId, deletedAt: null },
    distinct: ['playbackProfile'],
    select: { playbackProfile: true },
  });
  const set = new Set<PlaybackProfile>([DEFAULT_PLAYBACK_PROFILE]);
  for (const r of rows) set.add(r.playbackProfile as PlaybackProfile);
  return [...set];
}

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
  sourceFrameRate: number | null,
  log: Logger,
): Promise<{ processedKey: string; processedMime: string; processedPath: string }> {
  const tiers = await tiersInUse(prisma, media.organizationId);

  // The `standard` tier is the processed file every device falls back to; the
  // caller persists it onto the MediaAsset. Other tiers become MediaVariant rows.
  const standardKey = `${baseKey}/processed/video.mp4`;
  const standardPath = join(tmpDir, 'processed.mp4');

  for (const profile of tiers) {
    const isStandard = profile === DEFAULT_PLAYBACK_PROFILE;
    const outputPath = isStandard ? standardPath : join(tmpDir, `video-${profile}.mp4`);
    const storageKey = isStandard ? standardKey : `${baseKey}/processed/video-${profile}.mp4`;

    await runFfmpeg(
      buildArgsForTier(profile, { inputPath: originalPath, outputPath, sourceFrameRate }),
    );
    await uploadFileToS3(storageKey, outputPath, 'video/mp4');

    if (isStandard) {
      log.info({ mediaId: media.id }, 'worker: standard tier transcoded');
      continue;
    }

    const tierProbe = await probeMediaFile(outputPath);
    const tierStat = await stat(outputPath);
    const tierFields = {
      storageKey,
      width: tierProbe.width,
      height: tierProbe.height,
      bitrateKbps: VIDEO_TIERS[profile].videoBitrateKbps,
      sizeBytes: BigInt(tierStat.size),
      checksumSha256: await sha256File(outputPath),
    };
    const kind = videoVariantKindForProfile(profile);
    await prisma.mediaVariant.upsert({
      where: { mediaAssetId_kind: { mediaAssetId: media.id, kind } },
      create: { mediaAssetId: media.id, kind, mimeType: 'video/mp4', ...tierFields },
      update: tierFields,
    });
    log.info({ mediaId: media.id, tier: profile }, 'worker: tier variant uploaded');
  }

  // Drop variant rows for tiers no longer in use (and the legacy `fallback`
  // variant) so manifests and serving never reference stale tiers. The R2
  // objects are reclaimed by the retention job.
  const keptKinds = tiers
    .filter((p) => p !== DEFAULT_PLAYBACK_PROFILE)
    .map((p) => videoVariantKindForProfile(p));
  await prisma.mediaVariant.deleteMany({
    where: {
      mediaAssetId: media.id,
      kind: { in: ['fallback', 'video_high', 'video_standard', 'video_light'], notIn: keptKinds },
    },
  });

  return { processedKey: standardKey, processedMime: 'video/mp4', processedPath: standardPath };
}

function buildArgsForTier(
  profile: PlaybackProfile,
  io: { inputPath: string; outputPath: string; sourceFrameRate: number | null },
): string[] {
  const env = getEnv();
  const tier = VIDEO_TIERS[profile];
  // Env caps remain a global ceiling on top of the tier presets (e.g. a site
  // that wants to cap everything at 30fps can still do so via MAX_VIDEO_FPS).
  const capped = {
    ...tier,
    maxHeight: Math.min(tier.maxHeight, env.MAX_VIDEO_HEIGHT),
    maxFrameRate: Math.min(tier.maxFrameRate, env.MAX_VIDEO_FPS),
  };
  return buildTranscodeArgs(tierTranscodeOptions(capped, io));
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
      ? await processVideo(prisma, media, originalPath, tmpDir, baseKey, probe.frameRate, log)
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
