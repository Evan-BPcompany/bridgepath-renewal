jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import logger from '../utils/logger';
import { config, parseBooleanEnv } from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import {
  DisabledDownloadProvider,
  DownloadUrlProvider,
  assertFileDownloadConfiguration,
  decideFileDownload,
  isFileApproved
} from '../services/fileDownload';
import {
  ADMIN_ID,
  MANAGER_ID,
  ESTIMATE_ID,
  authCookie,
  createFakeDb,
  sqlOf
} from './helpers/adminTestUtils';

const FILE_ID = 'f0000000-0000-0000-0000-000000000001';
const OTHER_FILE_ID = 'f0000000-0000-0000-0000-000000000002';
const FILES_URL = `/admin/estimates/${ESTIMATE_ID}/files`;
const DOWNLOAD_URL = `${FILES_URL}/${FILE_ID}/download`;

const FILE_STATUSES = ['quarantine', 'pending_scan', 'approved', 'rejected'];
const SCAN_STATUSES = ['pending', 'passed', 'failed'];

describe('Admin file endpoints (mocked database, no S3)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const auditRecords = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  const withFile = (file_status: string, virus_scan_status: string) => {
    db.state.handler = (sql, params) => {
      if (sql.includes('AND estimate_id = $2')) {
        return params[0] === FILE_ID && params[1] === ESTIMATE_ID
          ? { rows: [{ id: FILE_ID, file_status, virus_scan_status }] }
          : { rows: [] };
      }
      return undefined;
    };
  };

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    (S3Client as unknown as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authentication', () => {
    it.each([[FILES_URL], [DOWNLOAD_URL]])('%s requires a valid session', async url => {
      expect((await request(app).get(url)).status).toBe(401);

      db.state.sessionExpired = true;
      expect((await request(app).get(url).set('Cookie', authCookie('admin'))).status).toBe(401);
      expect(sqlOf(db.state).filter(s => s.includes('FROM files'))).toHaveLength(0);
    });
  });

  describe('GET /admin/estimates/:id/files', () => {
    const fileRow = {
      id: FILE_ID,
      filename: 'logo.png',
      file_size: '2048',
      mime_type: 'image/png',
      file_status: 'quarantine',
      virus_scan_status: 'pending',
      uploaded_at: new Date('2026-10-13T01:00:00Z'),
      s3_key: 'estimates/secret/path.png',
      virus_scan_result: 'internal scanner output',
      scanned_at: new Date('2026-10-13T02:00:00Z')
    };

    beforeEach(() => {
      db.state.handler = sql => {
        if (sql.includes('SELECT 1 FROM estimates')) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('FROM files')) {
          return { rows: [fileRow] };
        }
        return undefined;
      };
    });

    it('returns metadata only, for both roles', async () => {
      for (const role of ['admin', 'manager'] as const) {
        const res = await request(app).get(FILES_URL).set('Cookie', authCookie(role));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([
          {
            id: FILE_ID,
            filename: 'logo.png',
            file_size: 2048,
            mime_type: 'image/png',
            file_status: 'quarantine',
            virus_scan_status: 'pending',
            uploaded_at: '2026-10-13T01:00:00.000Z',
            downloadable: false
          }
        ]);
      }
    });

    it('never returns or selects s3_key, scan output or scan time', async () => {
      const res = await request(app).get(FILES_URL).set('Cookie', authCookie('admin'));

      const text = JSON.stringify(res.body);
      for (const secret of ['s3_key', 'estimates/secret/path.png', 'virus_scan_result', 'internal scanner output', 'scanned_at']) {
        expect(text).not.toContain(secret);
      }

      const allSql = sqlOf(db.state).join('\n');
      for (const column of ['s3_key', 'virus_scan_result', 'scanned_at']) {
        expect(allSql).not.toContain(column);
      }
    });

    it('keeps downloadable false even for an approved and scanned file', async () => {
      db.state.handler = sql => {
        if (sql.includes('SELECT 1 FROM estimates')) {
          return { rows: [{}] };
        }
        return sql.includes('FROM files')
          ? { rows: [{ ...fileRow, file_status: 'approved', virus_scan_status: 'passed' }] }
          : undefined;
      };

      const res = await request(app).get(FILES_URL).set('Cookie', authCookie('admin'));
      expect(res.body.data[0].downloadable).toBe(false);
    });

    it('returns an empty list for an estimate without files', async () => {
      db.state.handler = sql => (sql.includes('SELECT 1 FROM estimates') ? { rows: [{}] } : undefined);

      const res = await request(app).get(FILES_URL).set('Cookie', authCookie('admin'));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 404 for an unknown estimate and 400 for a bad id', async () => {
      db.state.handler = () => undefined;

      const missing = await request(app).get(FILES_URL).set('Cookie', authCookie('admin'));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('ESTIMATE_NOT_FOUND');

      const bad = await request(app)
        .get('/admin/estimates/BP20261013001/files')
        .set('Cookie', authCookie('admin'));
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('INVALID_ID');
    });

    it('includes the same downloadable flag in the estimate detail', async () => {
      db.state.handler = sql => {
        if (sql.includes('FROM estimates WHERE id')) {
          return {
            rows: [
              {
                id: ESTIMATE_ID,
                receipt_id: 'BP20261013001',
                category: 'eyewear',
                status: 'new_receipt',
                specification_json: {},
                is_consultation: false,
                created_at: new Date(),
                updated_at: new Date()
              }
            ]
          };
        }
        return sql.includes('FROM files') ? { rows: [fileRow] } : undefined;
      };

      const res = await request(app)
        .get(`/admin/estimates/${ESTIMATE_ID}`)
        .set('Cookie', authCookie('admin'));

      expect(res.body.data.files[0].downloadable).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('estimates/secret/path.png');
    });
  });

  describe('GET /admin/estimates/:id/files/:fileId/download', () => {
    it('returns 400 INVALID_ID when either id is not a UUID', async () => {
      for (const url of [
        `/admin/estimates/not-a-uuid/files/${FILE_ID}/download`,
        `${FILES_URL}/not-a-uuid/download`
      ]) {
        const res = await request(app).get(url).set('Cookie', authCookie('admin'));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_ID');
      }
      expect(sqlOf(db.state).filter(s => s.includes('FROM files'))).toHaveLength(0);
    });

    it('returns 404 FILE_NOT_FOUND for a missing file or a file of another estimate', async () => {
      withFile('approved', 'passed');

      const missing = await request(app)
        .get(`${FILES_URL}/${OTHER_FILE_ID}/download`)
        .set('Cookie', authCookie('admin'));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('FILE_NOT_FOUND');

      const otherEstimate = await request(app)
        .get(`/admin/estimates/c0000000-0000-0000-0000-000000000099/files/${FILE_ID}/download`)
        .set('Cookie', authCookie('admin'));
      expect(otherEstimate.status).toBe(404);
      expect(otherEstimate.body.code).toBe('FILE_NOT_FOUND');
    });

    it('checks that the file belongs to the estimate and never selects s3_key', async () => {
      withFile('quarantine', 'pending');
      await request(app).get(DOWNLOAD_URL).set('Cookie', authCookie('admin'));

      const lookup = db.state.queries.find(q => q.sql.includes('FROM files'))!;
      expect(lookup.sql).toContain('WHERE id = $1 AND estimate_id = $2');
      expect(lookup.params).toEqual([FILE_ID, ESTIMATE_ID]);
      expect(sqlOf(db.state).join('\n')).not.toContain('s3_key');
    });

    const allCombinations = FILE_STATUSES.flatMap(file =>
      SCAN_STATUSES.map(scan => [file, scan] as [string, string])
    );

    it.each(allCombinations)(
      'always returns 403 FILE_NOT_APPROVED for file_status=%s, virus_scan_status=%s',
      async (fileStatus, scanStatus) => {
        withFile(fileStatus, scanStatus);

        for (const role of ['admin', 'manager'] as const) {
          const res = await request(app).get(DOWNLOAD_URL).set('Cookie', authCookie(role));

          expect(res.status).toBe(403);
          expect(res.body.code).toBe('FILE_NOT_APPROVED');
          expect(res.body.url).toBeUndefined();
          expect(res.body.data).toBeUndefined();
        }
      }
    );

    it('never touches S3, even for an approved and scanned file', async () => {
      withFile('approved', 'passed');
      const res = await request(app).get(DOWNLOAD_URL).set('Cookie', authCookie('admin'));

      expect(res.status).toBe(403);
      expect(S3Client).not.toHaveBeenCalled();
    });

    it('audits denied attempts and missing files without file names or keys', async () => {
      withFile('quarantine', 'pending');
      await request(app).get(DOWNLOAD_URL).set('Cookie', authCookie('manager'));
      await request(app).get(`${FILES_URL}/${OTHER_FILE_ID}/download`).set('Cookie', authCookie('manager'));

      const records = auditRecords();
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        action: 'file.access.attempt',
        result: 'denied',
        http_status: 403,
        error_code: 'FILE_NOT_APPROVED',
        admin_id: MANAGER_ID,
        role: 'manager',
        estimate_id: ESTIMATE_ID,
        file_id: FILE_ID
      });
      expect(records[1]).toMatchObject({
        action: 'file.access.attempt',
        result: 'not_found',
        http_status: 404,
        file_id: OTHER_FILE_ID
      });
    });

    it('audits metadata views', async () => {
      db.state.handler = sql => (sql.includes('SELECT 1 FROM estimates') ? { rows: [{}] } : undefined);
      await request(app).get(FILES_URL).set('Cookie', authCookie('admin'));

      expect(auditRecords()[0]).toMatchObject({
        action: 'file.list.view',
        result: 'success',
        admin_id: ADMIN_ID,
        estimate_id: ESTIMATE_ID
      });
    });
  });

  describe('download configuration', () => {
    const original = config.fileDownloadEnabled;

    afterEach(() => {
      config.fileDownloadEnabled = original;
    });

    it('is disabled by default', () => {
      expect(parseBooleanEnv('FILE_DOWNLOAD_ENABLED', undefined, false)).toBe(false);
      expect(parseBooleanEnv('FILE_DOWNLOAD_ENABLED', '', false)).toBe(false);
      expect(original).toBe(false);
    });

    it('parses true and false and rejects anything else', () => {
      expect(parseBooleanEnv('X', 'true', false)).toBe(true);
      expect(parseBooleanEnv('X', ' TRUE ', false)).toBe(true);
      expect(parseBooleanEnv('X', 'false', true)).toBe(false);
      expect(() => parseBooleanEnv('X', 'yes', false)).toThrow('X must be "true" or "false"');
      expect(() => parseBooleanEnv('X', '1', false)).toThrow();
    });

    it('refuses to create the app when the flag is on but no provider exists', () => {
      config.fileDownloadEnabled = true;
      expect(() => createApp()).toThrow(/FILE_DOWNLOAD_ENABLED=true but no download provider/);
    });

    it('starts normally when the flag is off', () => {
      config.fileDownloadEnabled = false;
      expect(() => createApp()).not.toThrow();
    });
  });
});

describe('download decision logic', () => {
  const implemented: DownloadUrlProvider = {
    implemented: true,
    issue: async () => ({ url: 'https://example.invalid/x', expiresInSeconds: 60 })
  };
  const approved = { id: 'f', file_status: 'approved', virus_scan_status: 'passed' };

  it('the placeholder provider is not implemented and never issues a URL', async () => {
    const provider = new DisabledDownloadProvider();
    expect(provider.implemented).toBe(false);
    await expect(provider.issue()).rejects.toThrow('disabled');
  });

  it('allows a download only when the flag, a real provider and an approved scanned file all exist', () => {
    expect(decideFileDownload({ enabled: true, provider: implemented, file: approved })).toEqual({ allowed: true });

    const denied = { allowed: false, code: 'FILE_NOT_APPROVED' };
    expect(decideFileDownload({ enabled: false, provider: implemented, file: approved })).toEqual(denied);
    expect(
      decideFileDownload({ enabled: true, provider: new DisabledDownloadProvider(), file: approved })
    ).toEqual(denied);
    expect(
      decideFileDownload({ enabled: true, provider: implemented, file: { ...approved, virus_scan_status: 'pending' } })
    ).toEqual(denied);
    expect(
      decideFileDownload({ enabled: true, provider: implemented, file: { ...approved, file_status: 'quarantine' } })
    ).toEqual(denied);
  });

  it('treats only approved + passed as approved', () => {
    for (const fileStatus of FILE_STATUSES) {
      for (const scanStatus of SCAN_STATUSES) {
        const expected = fileStatus === 'approved' && scanStatus === 'passed';
        expect(isFileApproved({ id: 'f', file_status: fileStatus, virus_scan_status: scanStatus })).toBe(expected);
      }
    }
  });

  it('only a provider that is actually implemented may be enabled', () => {
    expect(() => assertFileDownloadConfiguration(false, new DisabledDownloadProvider())).not.toThrow();
    expect(() => assertFileDownloadConfiguration(true, new DisabledDownloadProvider())).toThrow();
    expect(() => assertFileDownloadConfiguration(true, implemented)).not.toThrow();
  });
});
