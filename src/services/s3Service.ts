import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/env';
import logger from '../utils/logger';

let s3Client: S3Client | null = null;

export function initializeS3Client(): S3Client {
  if (!s3Client) {
    const clientConfig: any = {
      region: config.awsRegion
    };

    if (config.awsAccessKeyId && config.awsSecretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey
      };
    }

    s3Client = new S3Client(clientConfig);
  }
  return s3Client;
}

export async function uploadFileToS3(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  const client = initializeS3Client();

  const command = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ServerSideEncryption: 'AES256'
  });

  try {
    await client.send(command);
    logger.info('File uploaded to S3', { bucket: config.s3Bucket, key });
  } catch (err) {
    logger.error('S3 upload failed', {
      error: err instanceof Error ? err.message : String(err),
      bucket: config.s3Bucket,
      key
    });
    throw err;
  }
}

export function getS3KeyForEstimate(estimateId: string, fileId: string, extension: string): string {
  return `estimates/${estimateId}/${fileId}.${extension}`;
}
