import { createReadStream } from 'node:fs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getEnv } from '../env';

let client: S3Client | undefined;
let publicClient: S3Client | undefined;

export function getS3(): S3Client {
  if (!client) {
    const env = getEnv();
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return client;
}

/**
 * Client configured with the public endpoint, used only for presigning URLs
 * that browsers/devices (outside the docker network) must be able to reach.
 */
function getPublicS3(): S3Client {
  const env = getEnv();
  if (!env.S3_PUBLIC_ENDPOINT || env.S3_PUBLIC_ENDPOINT === env.S3_ENDPOINT) return getS3();
  if (!publicClient) {
    publicClient = new S3Client({
      endpoint: env.S3_PUBLIC_ENDPOINT,
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return publicClient;
}

export async function uploadFileToS3(
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const upload = new Upload({
    client: getS3(),
    params: {
      Bucket: getEnv().S3_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    },
  });
  await upload.done();
}

export async function uploadBufferToS3(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getEnv().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteFromS3(key: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }));
}

/** Presigns a temporary download URL (default 15 minutes). */
export async function presignDownload(key: string, expiresInSeconds = 900): Promise<string> {
  return getSignedUrl(
    getPublicS3(),
    new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
