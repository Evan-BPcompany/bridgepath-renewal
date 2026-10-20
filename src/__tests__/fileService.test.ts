jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import type { PoolClient } from 'pg';
import logger from '../utils/logger';
import { discardStoredFiles, insertFileRows, storeFiles, StoredFile } from '../services/fileService';
import type { FileStorage } from '../services/fileStorage';
import { createFakeDb } from './helpers/adminTestUtils';

const ESTIMATE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const KEY_PATTERN = new RegExp(`^estimates/${ESTIMATE_ID}/[0-9a-f]{32}\\.png$`);

// The files of a request are stored first and written to the database with the estimate, so
// here: a fake storage that logs every call, and a fake database for the rows.
describe('files of an estimate request (fake storage, fake database)', () => {
  let calls: string[];
  let storage: FileStorage;
  let putMock: jest.Mock;
  let removeMock: jest.Mock;
  let errorSpy: jest.SpyInstance;

  const file = (name: string, buffer: Buffer = PNG) => ({ buffer, mimeType: 'image/png', originalFilename: name });

  beforeEach(() => {
    calls = [];
    putMock = jest.fn(async (key: string) => {
      calls.push(`PUT ${key.slice(-8)}`);
    });
    removeMock = jest.fn(async (key: string) => {
      calls.push(`REMOVE ${key.slice(-8)}`);
    });
    storage = { put: putMock, remove: removeMock };
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('storeFiles', () => {
    it('stores every file under an estimate-scoped key the server made up, as quarantine', async () => {
      const stored = await storeFiles(ESTIMATE_ID, [file('logo.png'), file('photo.png')], storage);

      expect(stored).toHaveLength(2);
      stored.forEach(entry => {
        expect(entry.s3Key).toMatch(KEY_PATTERN);
        expect(entry).toMatchObject({ estimateId: ESTIMATE_ID, mimeType: 'image/png', fileSize: PNG.length, status: 'quarantine' });
      });
      expect(putMock).toHaveBeenCalledTimes(2);
      expect(putMock).toHaveBeenCalledWith(stored[0].s3Key, PNG, 'image/png');
    });

    it('gives every file its own id and key', async () => {
      const stored = await storeFiles(ESTIMATE_ID, [file('a.png'), file('a.png')], storage);

      expect(stored[0].id).not.toBe(stored[1].id);
      expect(stored[0].s3Key).not.toBe(stored[1].s3Key);
    });

    it('keeps the original name for display only, never in the key', async () => {
      const [stored] = await storeFiles(ESTIMATE_ID, [file('../../etc/로고 <b>.png')], storage);

      expect(stored.filename).toBe('로고 b.png');
      expect(stored.s3Key).toMatch(KEY_PATTERN);
      expect(stored.s3Key).not.toContain('etc');
    });

    it('does nothing for an empty list', async () => {
      await expect(storeFiles(ESTIMATE_ID, [], storage)).resolves.toEqual([]);

      expect(putMock).not.toHaveBeenCalled();
    });

    it('removes the files already stored when a later one fails, and reports the original error', async () => {
      putMock.mockImplementation(async (key: string) => {
        calls.push(`PUT ${key.slice(-8)}`);
        if (calls.filter(call => call.startsWith('PUT')).length === 3) {
          throw new Error('storage down');
        }
      });

      await expect(storeFiles(ESTIMATE_ID, [file('1.png'), file('2.png'), file('3.png')], storage)).rejects.toThrow(
        'storage down'
      );

      expect(removeMock).toHaveBeenCalledTimes(2);
      expect(calls.map(call => call.split(' ')[0])).toEqual(['PUT', 'PUT', 'PUT', 'REMOVE', 'REMOVE']);
    });

    it('removes nothing when the very first file fails', async () => {
      putMock.mockRejectedValue(new Error('storage down'));

      await expect(storeFiles(ESTIMATE_ID, [file('1.png'), file('2.png')], storage)).rejects.toThrow('storage down');

      expect(removeMock).not.toHaveBeenCalled();
      expect(putMock).toHaveBeenCalledTimes(1);
    });

    it('keeps removing the others when one removal fails, and still reports the original error', async () => {
      let puts = 0;
      putMock.mockImplementation(async () => {
        puts += 1;
        if (puts === 3) {
          throw new Error('storage down');
        }
      });
      removeMock.mockRejectedValueOnce(new Error('remove failed'));

      await expect(storeFiles(ESTIMATE_ID, [file('1.png'), file('2.png'), file('3.png')], storage)).rejects.toThrow(
        'storage down'
      );

      expect(removeMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('discardStoredFiles', () => {
    const stored: StoredFile[] = ['a', 'b', 'c'].map(name => ({
      id: name,
      estimateId: ESTIMATE_ID,
      s3Key: `estimates/${ESTIMATE_ID}/${name.repeat(32)}.png`,
      filename: `${name}.png`,
      mimeType: 'image/png',
      fileSize: 12,
      status: 'quarantine'
    }));

    it('removes every file', async () => {
      await discardStoredFiles(stored, storage);

      expect(removeMock.mock.calls.map(call => call[0])).toEqual(stored.map(entry => entry.s3Key));
    });

    it('goes on after a failure and logs it without the file name or key', async () => {
      removeMock.mockRejectedValueOnce(new Error('remove failed'));

      await discardStoredFiles(stored, storage);

      expect(removeMock).toHaveBeenCalledTimes(3);
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain('Failed to remove a stored file');
      expect(logged).not.toContain('a.png');
      expect(logged).not.toContain(stored[0].s3Key);
    });

    it('does nothing for an empty list', async () => {
      await discardStoredFiles([], storage);

      expect(removeMock).not.toHaveBeenCalled();
    });
  });

  describe('insertFileRows', () => {
    it('writes one quarantined, unscanned row per file inside the transaction it is given', async () => {
      const db = createFakeDb();
      const stored = await storeFiles(ESTIMATE_ID, [file('logo.png'), file('photo.png')], storage);

      await insertFileRows(db.client as unknown as PoolClient, stored);

      const inserts = db.state.queries.filter(query => query.sql.includes('INSERT INTO files'));
      expect(inserts).toHaveLength(2);
      expect(inserts[0].params).toEqual([
        stored[0].id, ESTIMATE_ID, 'logo.png', PNG.length, 'image/png', stored[0].s3Key, 'quarantine', 'pending'
      ]);
      // It opens no transaction of its own: BEGIN and COMMIT belong to createEstimate.
      expect(db.state.queries.some(query => /BEGIN|COMMIT|ROLLBACK/.test(query.sql))).toBe(false);
    });

    it('writes nothing for no files', async () => {
      const db = createFakeDb();

      await insertFileRows(db.client as unknown as PoolClient, []);

      expect(db.state.queries).toHaveLength(0);
    });
  });
});
