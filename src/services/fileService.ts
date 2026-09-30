import { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { uploadFileToS3, getS3KeyForEstimate } from './s3Service';
import { generateSafeFileId, getFileExtension } from '../utils/fileValidation';
import logger from '../utils/logger';

export interface UploadedFile {
  id: string;
  estimateId: string;
  s3Key: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: string;
}

export async function saveFileMetadata(
  client: PoolClient,
  estimateId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename: string
): Promise<UploadedFile> {
  const fileId = generateSafeFileId();
  const extension = getFileExtension(originalFilename);
  const s3Key = getS3KeyForEstimate(estimateId, fileId, extension);

  const query = `
    INSERT INTO files (
      id, estimate_id, filename, file_size, mime_type, s3_key, file_status, virus_scan_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, estimate_id, filename, file_size, mime_type, s3_key, file_status
  `;

  const result = await client.query(query, [
    fileId,
    estimateId,
    originalFilename,
    buffer.length,
    mimeType,
    s3Key,
    'quarantine',
    'pending'
  ]);

  if (result.rows.length === 0) {
    throw new Error('Failed to save file metadata');
  }

  const row = result.rows[0];

  return {
    id: row.id,
    estimateId: row.estimate_id,
    s3Key: row.s3_key,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    status: row.file_status
  };
}

export async function uploadFileWithMetadata(
  estimateId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename: string
): Promise<UploadedFile> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const metadata = await saveFileMetadata(client, estimateId, buffer, mimeType, originalFilename);

    try {
      await uploadFileToS3(metadata.s3Key, buffer, mimeType);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('S3 upload failed, file metadata rolled back', {
        estimateId,
        fileId: metadata.id,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }

    await client.query('COMMIT');

    logger.info('File uploaded successfully', {
      estimateId,
      fileId: metadata.id,
      s3Key: metadata.s3Key
    });

    return metadata;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback error
    }
    throw err;
  } finally {
    client.release();
  }
}
