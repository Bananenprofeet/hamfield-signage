import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('postgresql://signage:signage@localhost:5432/signage'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('signage-media'),
  S3_ACCESS_KEY: z.string().default('signage'),
  S3_SECRET_KEY: z.string().default('signage-secret'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  MAX_VIDEO_HEIGHT: z.coerce.number().int().min(240).default(1080),
  VIDEO_BITRATE_KBPS: z.coerce.number().int().min(250).default(6000),
  FALLBACK_VIDEO_BITRATE_KBPS: z.coerce.number().int().min(250).default(2000),
  CREATE_FALLBACK_VARIANT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  THUMBNAIL_MAX_DIMENSION: z.coerce.number().int().min(64).default(480),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
