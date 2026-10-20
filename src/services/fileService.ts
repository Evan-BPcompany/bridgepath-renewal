import { PoolClient } from 'pg';
import { getFileStorage, FileStorage } from './fileStorage';
import { getS3KeyForEstimate } from './s3Service';
import { displayFilename, generateSafeFileId, getFileExtension } from '../utils/fileValidation';
import logger from '../utils/logger';

// The files of an estimate request are all or nothing (PRD FR-4.7: a request whose attachment
// failed is not accepted, and no receipt number is shown):
//
//   1. storeFiles() puts every file in the storage (S3, or a local folder in development), under
//      the id the estimate is going to have. If one fails, the ones already stored are removed.
//   2. createEstimate() writes the estimate and the file rows in ONE transaction (insertFileRows).
//   3. If that fails, the route calls discardStoredFiles(), so no file is left without an estimate.
//
// A file is always stored as quarantine / virus scan pending: nothing approves a file yet, so the
// admin downloads stay blocked (see fileDownload.ts).

export interface StoredFile {
  id: string;
  estimateId: string;
  s3Key: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: string;
}

export interface FileToStore {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}

export async function storeFiles(
  estimateId: string,
  files: FileToStore[],
  storage: FileStorage = getFileStorage()
): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];

  try {
    for (const file of files) {
      const id = generateSafeFileId();
      const key = getS3KeyForEstimate(estimateId, id, getFileExtension(file.originalFilename));
      await storage.put(key, file.buffer, file.mimeType);
      stored.push({
        id,
        estimateId,
        s3Key: key,
        // The original name is for display only (PRD FR-2.8).
        filename: displayFilename(file.originalFilename),
        mimeType: file.mimeType,
        fileSize: file.buffer.length,
        status: 'quarantine'
      });
    }
    return stored;
  } catch (err) {
    logger.error('Storing the files failed, removing the ones already stored', {
      estimateId,
      storedCount: stored.length,
      error: err instanceof Error ? err.message : String(err)
    });
    await discardStoredFiles(stored, storage);
    throw err;
  }
}

// Best effort: a file that cannot be removed is logged (without its name) and the rest go on.
export async function discardStoredFiles(
  files: StoredFile[],
  storage: FileStorage = getFileStorage()
): Promise<void> {
  for (const file of files) {
    try {
      await storage.remove(file.s3Key);
    } catch (err) {
      logger.error('Failed to remove a stored file', {
        estimateId: file.estimateId,
        fileId: file.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

// Called by createEstimate inside its transaction.
export async function insertFileRows(client: PoolClient, files: StoredFile[]): Promise<void> {
  for (const file of files) {
    await client.query(
      `INSERT INTO files (
         id, estimate_id, filename, file_size, mime_type, s3_key, file_status, virus_scan_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [file.id, file.estimateId, file.filename, file.fileSize, file.mimeType, file.s3Key, 'quarantine', 'pending']
    );
  }
}
