import Redis from 'ioredis';
import { getEnv } from '../env';

let pub: Redis | undefined;
let sub: Redis | undefined;

export function getRedisPub(): Redis {
  if (!pub) pub = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return pub;
}

export function getRedisSub(): Redis {
  if (!sub) sub = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  return sub;
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([pub?.quit(), sub?.quit()]);
  pub = undefined;
  sub = undefined;
}

export const CHANNEL_PREFIX = 'signage';
export const deviceChannel = (deviceId: string) => `${CHANNEL_PREFIX}:device:${deviceId}`;
export const orgChannel = (orgId: string) => `${CHANNEL_PREFIX}:org:${orgId}`;
