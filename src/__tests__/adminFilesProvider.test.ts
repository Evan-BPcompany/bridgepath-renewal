jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn()
}));

// Simulates the future state (real provider, flag on) with a fake provider, to prove the
// activation structure works. No S3 and no signed URLs are involved.
const mockIssue = jest.fn();
jest.mock('../services/fileDownload', () => ({
  ...jest.requireActual('../services/fileDownload'),
  downloadProvider: {
    implemented: true,
    issue: (...args: unknown[]) => mockIssue(...args)
  }
}));

import request from 'supertest';
import { S3Client } from '@aws-sdk/client-s3';
import logger from '../utils/logger';
import { config } from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { ESTIMATE_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

const FILE_ID = 'f0000000-0000-0000-0000-000000000001';
const DOWNLOAD_URL = `/admin/estimates/${ESTIMATE_ID}/files/${FILE_ID}/download`;

describe('download activation structure (fake provider)', () => {
  const original = config.fileDownloadEnabled;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;

  const withFile = (file_status: string, virus_scan_status: string) => {
    db.state.handler = sql =>
      sql.includes('AND estimate_id = $2')
        ? { rows: [{ id: FILE_ID, file_status, virus_scan_status }] }
        : undefined;
  };

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    mockIssue.mockReset();
    mockIssue.mockResolvedValue({ url: 'https://downloads.example.invalid/signed?sig=SECRET', expiresInSeconds: 60 });
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    config.fileDownloadEnabled = true;
  });

  afterEach(() => {
    config.fileDownloadEnabled = original;
    jest.restoreAllMocks();
  });

  it('starts when the flag is on and a real provider exists', () => {
    expect(() => createApp()).not.toThrow();
  });

  it('issues a short-lived URL only for an approved and scanned file', async () => {
    withFile('approved', 'passed');
    const res = await request(createApp()).get(DOWNLOAD_URL).set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      url: 'https://downloads.example.invalid/signed?sig=SECRET',
      expires_in_seconds: 60
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockIssue).toHaveBeenCalledWith(ESTIMATE_ID, {
      id: FILE_ID,
      file_status: 'approved',
      virus_scan_status: 'passed'
    });
    expect(S3Client).not.toHaveBeenCalled();
  });

  it.each([
    ['quarantine', 'pending'],
    ['pending_scan', 'pending'],
    ['approved', 'pending'],
    ['approved', 'failed'],
    ['rejected', 'passed'],
    ['quarantine', 'passed']
  ])('still blocks file_status=%s, virus_scan_status=%s', async (fileStatus, scanStatus) => {
    withFile(fileStatus, scanStatus);
    const res = await request(createApp()).get(DOWNLOAD_URL).set('Cookie', authCookie('admin'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FILE_NOT_APPROVED');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('does not write the signed URL to the audit log', async () => {
    withFile('approved', 'passed');
    await request(createApp()).get(DOWNLOAD_URL).set('Cookie', authCookie('admin'));

    const text = JSON.stringify(infoSpy.mock.calls);
    expect(text).toContain('file.access.attempt');
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('downloads.example.invalid');
  });

  it('lists the file as downloadable only when it is approved and scanned', async () => {
    db.state.handler = sql => {
      if (sql.includes('SELECT 1 FROM estimates')) {
        return { rows: [{}] };
      }
      return sql.includes('FROM files')
        ? {
            rows: [
              { id: 'a', filename: 'a.png', file_size: 1, mime_type: 'image/png', file_status: 'approved', virus_scan_status: 'passed', uploaded_at: new Date() },
              { id: 'b', filename: 'b.png', file_size: 1, mime_type: 'image/png', file_status: 'quarantine', virus_scan_status: 'pending', uploaded_at: new Date() }
            ]
          }
        : undefined;
    };

    const res = await request(createApp())
      .get(`/admin/estimates/${ESTIMATE_ID}/files`)
      .set('Cookie', authCookie('admin'));

    expect(res.body.data.map((f: { downloadable: boolean }) => f.downloadable)).toEqual([true, false]);
  });
});
