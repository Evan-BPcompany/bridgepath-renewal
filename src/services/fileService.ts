import { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { uploadFileToS3, getS3KeyForEstimate, deleteFileFromS3 } from './s3Service';
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

async function deleteFileMetadata(fileId: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const query = 'DELETE FROM files WHERE id = $1';
    await client.query(query, [fileId]);
    logger.info('File metadata deleted', { fileId });
  } catch (err) {
    logger.error('Failed to delete file metadata', {
      fileId,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
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

    try {
      await client.query('COMMIT');
    } catch (err) {
      logger.error('DB commit failed, deleting S3 object', {
        estimateId,
        fileId: metadata.id,
        s3Key: metadata.s3Key,
        error: err instanceof Error ? err.message : String(err)
      });
      try {
        await deleteFileFromS3(metadata.s3Key);
      } catch (deleteErr) {
        logger.error('Failed to delete S3 object during rollback', {
          estimateId,
          fileId: metadata.id,
          s3Key: metadata.s3Key,
          error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
        });
      }
      throw err;
    }

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

export async function uploadMultipleFilesWithMetadata(
  estimateId: string,
  files: Array<{ buffer: Buffer; mimeType: string; originalFilename: string }>
): Promise<UploadedFile[]> {
  const uploadedFiles: UploadedFile[] = [];

  try {
    for (const file of files) {
      const uploaded = await uploadFileWithMetadata(estimateId, file.buffer, file.mimeType, file.originalFilename);
      uploadedFiles.push(uploaded);
    }
    return uploadedFiles;
  } catch (err) {
    logger.error('Multiple file upload failed, compensating S3 and DB', {
      estimateId,
      uploadedCount: uploadedFiles.length,
      error: err instanceof Error ? err.message : String(err)
    });

    for (const file of uploadedFiles) {
      try {
        await deleteFileFromS3(file.s3Key);
      } catch (deleteErr) {
        logger.error('Failed to delete S3 object during compensation', {
          estimateId,
          fileId: file.id,
          s3Key: file.s3Key,
          error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
        });
      }

      try {
        await deleteFileMetadata(file.id);
      } catch (deleteErr) {
        logger.error('Failed to delete file metadata during compensation', {
          estimateId,
          fileId: file.id,
          error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr)
        });
      }
    }

    throw err;
  }
}
