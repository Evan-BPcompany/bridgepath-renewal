jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import * as fileService from '../services/fileService';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { SHOE_SPEC, createTestApp, resetData } from './helpers/fixtures';

// The attachments of an estimate request on a real PostgreSQL, with the LOCAL file storage (a
// temporary folder): the request is saved with its files or not at all (PRD FR-4.7). S3 and
// SendGrid are not involved.
describeIntegration('estimate requests with files on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let folder: string;
  let originalStorage: typeof config.fileStorage;
  let originalDir: string;

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 9)]);

  const send = (specification: object = SHOE_SPEC) =>
    request(app)
      .post('/api/estimates')
      .field('category', 'shoes')
      .field('specification_json', JSON.stringify(specification))
      .field('customer_type', 'individual_startup')
      .field('customer_name', 'Kim')
      .field('customer_email', 'buyer@example.com')
      .field('privacy_consent', 'true')
      .field('privacy_consent_version', 'dev-draft');

  const count = async (table: string) => Number((await suite().db(table).count({ n: '*' }).first())?.n);
  const storedFiles = (): string[] => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          found.push(full);
        }
      }
    };
    walk(folder);
    return found;
  };

  beforeEach(async () => {
    await resetData(suite().db);
    app = createTestApp();
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-it-files-'));
    originalStorage = config.fileStorage;
    originalDir = config.localUploadDir;
    config.fileStorage = 'local';
    config.localUploadDir = folder;
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    config.fileStorage = originalStorage;
    config.localUploadDir = originalDir;
    fs.rmSync(folder, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('saves the estimate and one row per file, stored under the id of the estimate, as quarantine', async () => {
    const res = await send()
      .attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .attach('files', PDF, { filename: 'spec.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.files.map((file: { filename: string }) => file.filename)).toEqual(['logo.png', 'spec.pdf']);
    expect(JSON.stringify(res.body)).not.toContain('estimates/');

    const estimate = await suite().db('estimates').where({ receipt_id: res.body.receipt_id }).first();
    const rows = await suite().db('files').where({ estimate_id: estimate.id }).orderBy('filename');
    expect(rows).toHaveLength(2);
    expect(rows.map(row => [row.filename, row.mime_type, Number(row.file_size)])).toEqual([
      ['logo.png', 'image/png', PNG.length],
      ['spec.pdf', 'application/pdf', PDF.length]
    ]);
    for (const row of rows) {
      expect(row.file_status).toBe('quarantine');
      expect(row.virus_scan_status).toBe('pending');
      expect(row.s3_key).toMatch(new RegExp(`^estimates/${estimate.id}/[0-9a-f]{32}\\.(png|pdf)$`));
    }

    // The bytes are in the storage, under the key of the row.
    const logo = rows.find(row => row.filename === 'logo.png');
    expect(fs.readFileSync(path.join(folder, logo.s3_key)).equals(PNG)).toBe(true);
    expect(storedFiles()).toHaveLength(2);
  });

  it('keeps a Korean file name as it was written', async () => {
    const res = await send().attach('files', PNG, { filename: '내 로고 (최종).png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    const row = await suite().db('files').first();
    expect(row.filename).toBe('내 로고 (최종).png');
    expect(row.s3_key).not.toContain('로고');
  });

  it('saves a request without files as before: no file rows, nothing stored', async () => {
    const res = await send();

    expect(res.status).toBe(201);
    expect(res.body.files).toBeUndefined();
    expect(await count('files')).toBe(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('saves nothing and keeps no file when the database fails after the files were stored', async () => {
    jest.spyOn(fileService, 'insertFileRows').mockRejectedValueOnce(new Error('simulated database failure'));

    const res = await send().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    expect(res.body.receipt_id).toBeUndefined();
    expect(await count('estimates')).toBe(0);
    expect(await count('files')).toBe(0);
    expect(await count('email_events')).toBe(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('gives the receipt number back when the request failed, so the next one has no gap', async () => {
    jest.spyOn(fileService, 'insertFileRows').mockRejectedValueOnce(new Error('simulated database failure'));
    await send().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

    const next = await send();

    expect(next.status).toBe(201);
    expect(next.body.receipt_id).toMatch(/001$/);
  });

  it('saves nothing when the files cannot be stored, and takes no receipt number', async () => {
    // A folder that cannot be made: a file stands where it should be.
    const blocker = path.join(folder, 'blocker');
    fs.writeFileSync(blocker, 'x');
    config.localUploadDir = path.join(blocker, 'inside');

    const res = await send().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('FILE_UPLOAD_FAILED');
    expect(await count('estimates')).toBe(0);
    expect(await count('files')).toBe(0);
    expect(await count('email_events')).toBe(0);

    config.localUploadDir = folder;
    const next = await send();
    expect(next.body.receipt_id).toMatch(/001$/);
  });

  it('refuses what is not allowed before anything is stored or saved', async () => {
    const gif = await send().attach('files', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });
    const sixth = await ['1', '2', '3', '4', '5', '6'].reduce(
      (req, n) => req.attach('files', PNG, { filename: `${n}.png`, contentType: 'image/png' }),
      send()
    );

    expect(gif.status).toBe(400);
    expect(sixth.status).toBe(400);
    expect(await count('estimates')).toBe(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('stores the AI screen record with the specification, and drops a malformed one', async () => {
    const preview = {
      source: 'customer_screen',
      price: { currency: 'KRW', quantity: 500, unit_price: { min: 8300, max: 11300 }, total_price: { min: 4150000, max: 5650000 } }
    };

    const good = await send({ ...SHOE_SPEC, ai_preview: preview });
    const bad = await send({ ...SHOE_SPEC, ai_preview: { ...preview, secret: 'x' } });

    expect(good.status).toBe(201);
    expect(bad.status).toBe(201);
    const goodRow = await suite().db('estimates').where({ receipt_id: good.body.receipt_id }).first();
    const badRow = await suite().db('estimates').where({ receipt_id: bad.body.receipt_id }).first();
    expect(goodRow.specification_json.ai_preview).toEqual(preview);
    expect(badRow.specification_json.ai_preview).toBeUndefined();
    expect(badRow.specification_json.quantity).toBe(500);
  });

  it('removes the file rows with the estimate (foreign key cascade)', async () => {
    const res = await send().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });
    expect(await count('files')).toBe(1);

    // The e-mail rows keep their estimate (no cascade there); the files must go with it.
    const estimate = await suite().db('estimates').where({ receipt_id: res.body.receipt_id }).first();
    await suite().db('email_events').where({ estimate_id: estimate.id }).del();
    await suite().db('estimates').where({ id: estimate.id }).del();

    expect(await count('files')).toBe(0);
  });
});
