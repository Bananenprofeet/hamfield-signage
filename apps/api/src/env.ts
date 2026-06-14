import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1).default('postgresql://signage:signage@localhost:5432/signage'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-do-not-use-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('signage-media'),
  S3_ACCESS_KEY: z.string().default('signage'),
  S3_SECRET_KEY: z.string().default('signage-secret'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .default(1024 * 1024 * 1024),
  PAIRING_CODE_TTL_MINUTES: z.coerce.number().int().default(15),
  // Install-time superadmin bootstrap (all three must be set to take effect).
  // Empty strings (e.g. compose defaults) are treated as unset.
  INITIAL_SUPERADMIN_EMAIL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email().optional(),
  ),
  INITIAL_SUPERADMIN_PASSWORD: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().optional(),
  ),
  INITIAL_SUPERADMIN_NAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
    if (cached.NODE_ENV === 'production' && cached.JWT_SECRET.startsWith('dev-only-secret')) {
      throw new Error('JWT_SECRET must be set to a strong value in production');
    }
  }
  return cached;
}

export function corsOrigins(): string[] {
  return getEnv()
    .CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
