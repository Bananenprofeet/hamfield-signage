/**
 * Re-enqueues existing media for processing — re-runs the FFmpeg transcode (with
 * the worker's current settings) on the original that is still in object
 * storage, then replaces the processed file. Use this after changing encoding
 * settings (e.g. the frame-rate cap) to bring already-uploaded media up to date.
 * Safe and idempotent: originals are untouched and devices re-download a changed
 * file automatically on their next sync.
 *
 * Usage (inside the api container):
 *   node apps/api/dist/cli/reprocess-media.js                # every video, all orgs
 *   node apps/api/dist/cli/reprocess-media.js <orgId>        # one org's videos
 *   node apps/api/dist/cli/reprocess-media.js <orgId> --images  # videos AND images
 */
import { getPrisma, disconnectPrisma } from '@signage/database';
import { getMediaQueue, closeQueues } from '../lib/queues';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const includeImages = args.includes('--images');
  const orgId = args.find((a) => !a.startsWith('--'));

  const prisma = getPrisma();
  const queue = getMediaQueue();

  const media = await prisma.mediaAsset.findMany({
    where: {
      deletedAt: null,
      ...(orgId ? { organizationId: orgId } : {}),
      ...(includeImages ? {} : { mediaType: 'video' }),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  if (media.length === 0) {
    console.log('No matching media found — nothing to reprocess.');
    return;
  }

  const scope = orgId ? `org ${orgId}` : 'all organizations';
  console.log(
    `Re-enqueuing ${media.length} ${includeImages ? 'media item' : 'video'}(s) in ${scope}…`,
  );

  let queued = 0;
  for (const m of media) {
    await prisma.mediaAsset.update({
      where: { id: m.id },
      data: { processingStatus: 'pending', processingError: null },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: { mediaAssetId: m.id, status: 'queued' },
    });
    await queue.add('process', { mediaAssetId: m.id, jobRecordId: job.id });
    queued += 1;
    if (queued % 25 === 0 || queued === media.length) {
      console.log(`  queued ${queued}/${media.length}`);
    }
  }

  console.log(
    `Done — ${queued} job(s) queued. The worker processes them in the background; ` +
      `watch progress in the dashboard (each item goes pending → processing → ready).`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await disconnectPrisma();
  });
