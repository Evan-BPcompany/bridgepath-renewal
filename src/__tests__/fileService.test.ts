jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/s3Service', () => ({
  ...jest.requireActual('../services/s3Service'),
  uploadFileToS3: jest.fn(),
  deleteFileFromS3: jest.fn()
}));

import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import logger from '../utils/logger';
import { deleteFileFromS3, uploadFileToS3 } from '../services/s3Service';
import {
  saveFileMetadata,
  uploadFileWithMetadata,
  uploadMultipleFilesWithMetadata
} from '../services/fileService';
import { createFakeDb } from './helpers/adminTestUtils';

const upload = uploadFileToS3 as jest.Mock;
const remove = deleteFileFromS3 as jest.Mock;

const ESTIMATE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const KEY_PATTERN = new RegExp(`^estimates/${ESTIMATE_ID}/[0-9a-f]{32}\\.png$`);

// Upload and compensation flows, with a fake database and S3 replaced by a mock.
// Order matters here, so every database statement and every S3 call is logged in one list.
describe('file upload with metadata and compensation (fake database, mocked S3)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let calls: string[];
  let errorSpy: jest.SpyInstance;

  const file = (name: string) => ({ buffer: PNG, mimeType: 'image/png', originalFilename: name });
  const sqlCalls = () => calls.filter(c => c.startsWith('SQL:')).map(c => c.slice(4));
  const insertedRow = (params: unknown[]) => ({
    rows: [
      {
        id: params[0],
        estimate_id: params[1],
        filename: params[2],
        file_size: params[3],
        mime_type: params[4],
        s3_key: params[5],
        file_status: params[6]
      }
    ]
  });
  // A handler that behaves like the default one but makes COMMIT fail.
  const failCommit = () => {
    const original = db.state.handler;
    db.state.handler = (sql, params) => {
      if (sql.trim() === 'COMMIT') {
        throw new Error('commit failed');
      }
      return original(sql, params);
    };
  };

  beforeEach(() => {
    db = createFakeDb();
    calls = [];
    (getPool as jest.Mock).mockReturnValue(db.pool);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);

    db.state.handler = (sql, params) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push(`SQL:${text.startsWith('INSERT INTO files') ? 'INSERT' : text.startsWith('DELETE FROM files') ? 'DELETE' : text}`);
      return text.startsWith('INSERT INTO files') ? insertedRow(params) : undefined;
    };

    upload.mockReset();
    remove.mockReset();
    upload.mockImplementation(async (key: string) => {
      calls.push(`S3 PUT ${key.slice(-8)}`);
    });
    remove.mockImplementation(async (key: string) => {
      calls.push(`S3 DELETE ${key.slice(-8)}`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('saveFileMetadata', () => {
    it('stores a quarantined, unscanned file under an estimate-scoped S3 key', async () => {
      const metadata = await saveFileMetadata(db.client as unknown as PoolClient, ESTIMATE_ID, PNG, 'image/png', 'logo.png');

      const insert = db.state.queries.find(q => q.sql.includes('INSERT INTO files'))!;
      expect(insert.params[1]).toBe(ESTIMATE_ID);
      expect(insert.params[2]).toBe('logo.png');
      expect(insert.params[3]).toBe(PNG.length);
      expect(insert.params[4]).toBe('image/png');
      expect(insert.params[5]).toMatch(KEY_PATTERN);
      expect(insert.params.slice(6)).toEqual(['quarantine', 'pending']);
      expect(metadata).toMatchObject({ estimateId: ESTIMATE_ID, filename: 'logo.png', status: 'quarantine', fileSize: PNG.length });
      expect(metadata.s3Key).toMatch(KEY_PATTERN);
    });

    it('gives every file its own id and key', async () => {
      const first = await saveFileMetadata(db.client as unknown as PoolClient, ESTIMATE_ID, PNG, 'image/png', 'a.png');
      const second = await saveFileMetadata(db.client as unknown as PoolClient, ESTIMATE_ID, PNG, 'image/png', 'a.png');

      expect(first.id).not.toBe(second.id);
      expect(first.s3Key).not.toBe(second.s3Key);
    });

    it('saveFileMetadata fails when the insert returns no row', async () => {
      db.state.handler = () => ({ rows: [] });

      await expect(
        saveFileMetadata(db.client as unknown as PoolClient, ESTIMATE_ID, PNG, 'image/png', 'a.png')
      ).rejects.toThrow('Failed to save file metadata');
    });
  });

  describe('uploadFileWithMetadata', () => {
    it('saves the metadata, uploads to S3, then commits, in that order', async () => {
      const uploaded = await uploadFileWithMetadata(ESTIMATE_ID, PNG, 'image/png', 'logo.png');

      expect(calls.filter(c => c !== 'SQL:SELECT 1')).toEqual([
        'SQL:BEGIN',
        'SQL:INSERT',
        `S3 PUT ${uploaded.s3Key.slice(-8)}`,
        'SQL:COMMIT'
      ]);
      expect(upload).toHaveBeenCalledWith(uploaded.s3Key, PNG, 'image/png');
      expect(uploaded.status).toBe('quarantine');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('rolls the metadata back and deletes nothing when the S3 upload fails', async () => {
      upload.mockRejectedValueOnce(new Error('S3 down'));

      await expect(uploadFileWithMetadata(ESTIMATE_ID, PNG, 'image/png', 'logo.png')).rejects.toThrow('S3 down');

      expect(sqlCalls()).toContain('ROLLBACK');
      expect(sqlCalls()).not.toContain('COMMIT');
      expect(remove).not.toHaveBeenCalled();
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('never uploads when saving the metadata fails', async () => {
      db.state.handler = sql => {
        if (sql.includes('INSERT INTO files')) {
          throw new Error('insert failed');
        }
        return undefined;
      };

      await expect(uploadFileWithMetadata(ESTIMATE_ID, PNG, 'image/png', 'logo.png')).rejects.toThrow('insert failed');

      expect(upload).not.toHaveBeenCalled();
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('deletes the uploaded S3 object when the commit fails', async () => {
      failCommit();

      await expect(uploadFileWithMetadata(ESTIMATE_ID, PNG, 'image/png', 'logo.png')).rejects.toThrow('commit failed');

      const key = upload.mock.calls[0][0] as string;
      expect(remove).toHaveBeenCalledWith(key);
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('reports the commit error, not the cleanup error, when both fail', async () => {
      failCommit();
      remove.mockRejectedValueOnce(new Error('S3 delete failed'));

      await expect(uploadFileWithMetadata(ESTIMATE_ID, PNG, 'image/png', 'logo.png')).rejects.toThrow('commit failed');

      expect(errorSpy).toHaveBeenCalledWith('Failed to delete S3 object during rollback', expect.any(Object));
    });
  });

  describe('uploadMultipleFilesWithMetadata', () => {
    it('uploads every file in its own transaction and returns them in order', async () => {
      const uploaded = await uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png'), file('c.png')]);

      expect(uploaded.map(f => f.filename)).toEqual(['a.png', 'b.png', 'c.png']);
      expect(sqlCalls().filter(c => c === 'BEGIN')).toHaveLength(3);
      expect(sqlCalls().filter(c => c === 'COMMIT')).toHaveLength(3);
      expect(remove).not.toHaveBeenCalled();
    });

    it('does nothing for an empty list', async () => {
      expect(await uploadMultipleFilesWithMetadata(ESTIMATE_ID, [])).toEqual([]);
      expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('removes the S3 object and the database row of an earlier file when a later one fails', async () => {
      upload.mockImplementationOnce(async (key: string) => {
        calls.push(`S3 PUT ${key.slice(-8)}`);
      });
      upload.mockImplementationOnce(async () => {
        throw new Error('S3 down');
      });

      await expect(uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png')])).rejects.toThrow('S3 down');

      const firstKey = upload.mock.calls[0][0] as string;
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith(firstKey);

      const firstId = firstKey.split('/')[2].replace('.png', '');
      const deletion = db.state.queries.find(q => q.sql.includes('DELETE FROM files'))!;
      expect(deletion.params).toEqual([firstId]);

      const s3Delete = calls.findIndex(c => c.startsWith('S3 DELETE'));
      const dbDelete = calls.indexOf('SQL:DELETE');
      expect(s3Delete).toBeGreaterThan(-1);
      expect(dbDelete).toBeGreaterThan(s3Delete);
    });

    it('compensates every earlier file when the third one fails, but not the failing one', async () => {
      upload.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('S3 down'));

      await expect(
        uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png'), file('c.png')])
      ).rejects.toThrow('S3 down');

      expect(remove.mock.calls.map(c => c[0])).toEqual([upload.mock.calls[0][0], upload.mock.calls[1][0]]);
      expect(db.state.queries.filter(q => q.sql.includes('DELETE FROM files'))).toHaveLength(2);
    });

    it('does not compensate anything when the very first file fails', async () => {
      upload.mockRejectedValueOnce(new Error('S3 down'));

      await expect(uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png')])).rejects.toThrow('S3 down');

      expect(remove).not.toHaveBeenCalled();
      expect(db.state.queries.some(q => q.sql.includes('DELETE FROM files'))).toBe(false);
    });

    it('still deletes the database row when the S3 delete fails, and reports the original error', async () => {
      upload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('S3 down'));
      remove.mockRejectedValueOnce(new Error('S3 delete failed'));

      await expect(uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png')])).rejects.toThrow('S3 down');

      expect(db.state.queries.filter(q => q.sql.includes('DELETE FROM files'))).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledWith('Failed to delete S3 object during compensation', expect.any(Object));
    });

    it('keeps compensating the other files when one database delete fails', async () => {
      upload.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('S3 down'));
      const original = db.state.handler;
      let deletes = 0;
      db.state.handler = (sql, params) => {
        if (sql.includes('DELETE FROM files')) {
          deletes += 1;
          if (deletes === 1) {
            throw new Error('delete failed');
          }
        }
        return original(sql, params);
      };

      await expect(
        uploadMultipleFilesWithMetadata(ESTIMATE_ID, [file('a.png'), file('b.png'), file('c.png')])
      ).rejects.toThrow('S3 down');

      expect(remove).toHaveBeenCalledTimes(2);
      expect(deletes).toBe(2);
      expect(errorSpy).toHaveBeenCalledWith('Failed to delete file metadata', expect.any(Object));
    });
  });
});
