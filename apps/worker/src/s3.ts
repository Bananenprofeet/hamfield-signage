import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getEnv } from './env';

let client: S3Client | undefined;

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

export async function downloadFromS3(key: string, destinationPath: string): Promise<void> {
  const response = await getS3().send(
    new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: key }),
  );
  if (!response.Body) throw new Error(`Empty S3 response body for ${key}`);
  await pipeline(response.Body as Readable, createWriteStream(destinationPath));
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
