import { getPool } from '../config/database';
import { config } from '../config/env';
import {
  DownloadableFile,
  decideFileDownload,
  downloadProvider
} from './fileDownload';

export interface FileMetadata {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  file_status: string;
  virus_scan_status: string;
  uploaded_at: string;
  downloadable: boolean;
}

// s3_key, virus_scan_result and scanned_at are never selected.
export const FILE_METADATA_COLUMNS =
  'id, filename, file_size, mime_type, file_status, virus_scan_status, uploaded_at';

export function toFileMetadata(row: Record<string, unknown>): FileMetadata {
  const file = row as unknown as DownloadableFile & {
    filename: string;
    file_size: string | number;
    mime_type: string;
    uploaded_at: string | number | Date;
  };

  return {
    id: file.id,
    filename: file.filename,
    file_size: Number(file.file_size),
    mime_type: file.mime_type,
    file_status: file.file_status,
    virus_scan_status: file.virus_scan_status,
    uploaded_at: new Date(file.uploaded_at).toISOString(),
    downloadable: decideFileDownload({
      enabled: config.fileDownloadEnabled,
      provider: downloadProvider,
      file
    }).allowed
  };
}

export async function listEstimateFiles(estimateId: string): Promise<FileMetadata[] | null> {
  const pool = getPool();

  const exists = await pool.query(`SELECT 1 FROM estimates WHERE id = $1`, [estimateId]);
  if (exists.rows.length === 0) {
    return null;
  }

  const result = await pool.query(
    `SELECT ${FILE_METADATA_COLUMNS} FROM files
     WHERE estimate_id = $1 ORDER BY uploaded_at ASC, id ASC`,
    [estimateId]
  );

  return result.rows.map(toFileMetadata);
}

// The file must belong to the estimate in the URL; only status columns are read.
export async function findEstimateFile(
  estimateId: string,
  fileId: string
): Promise<DownloadableFile | null> {
  const pool = getPool();

  const result = await pool.query(
    `SELECT id, file_status, virus_scan_status FROM files WHERE id = $1 AND estimate_id = $2`,
    [fileId, estimateId]
  );

  return result.rows.length === 0 ? null : (result.rows[0] as DownloadableFile);
}
