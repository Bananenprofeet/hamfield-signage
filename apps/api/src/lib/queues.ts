import { Queue } from 'bullmq';
import { getEnv } from '../env';

export const MEDIA_QUEUE_NAME = 'media-processing';

export interface MediaJobData {
  mediaAssetId: string;
  jobRecordId: string;
}

let mediaQueue: Queue<MediaJobData> | undefined;

function redisConnection() {
  const url = new URL(getEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

export function getMediaQueue(): Queue<MediaJobData> {
  if (!mediaQueue) {
    mediaQueue = new Queue<MediaJobData>(MEDIA_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return mediaQueue;
}

export async function closeQueues(): Promise<void> {
  await mediaQueue?.close();
  mediaQueue = undefined;
}
