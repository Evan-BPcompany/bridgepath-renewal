jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({ uploadMultipleFilesWithMetadata: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { createApp } from '../app';
import { PROFILE, withMultipartProfile } from './helpers/customerFixtures';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../services/fileService';
import { hashEstimateToken } from '../utils/token';

const create = createEstimate as jest.Mock;
const lookup = getEstimateByReceiptId as jest.Mock;
const uploadFiles = uploadMultipleFilesWithMetadata as jest.Mock;

const SPEC = { schema_version: '1.0', shoe_type: 'Running', material: 'Mesh', size_range: '240-250', quantity: 500 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const CREATED = {
  success: true,
  receipt_id: 'BP20261013001',
  estimate_id: 'internal-estimate-uuid',
  status: 'new_receipt',
  access_token: 'a'.repeat(64),
  created_at: '2026-10-13T03:00:00.000Z'
};

// The public customer API contract, over HTTP, with the services replaced by mocks.
describe('customer API contract (POST/GET /api/estimates)', () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
    create.mockReset().mockResolvedValue(CREATED);
    lookup.mockReset();
    uploadFiles.mockReset();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/estimates', () => {
    const post = () => request(app).post('/api/estimates');

    it('answers 201 with exactly the public fields and never exposes the internal estimate id', async () => {
      const res = await post().send({ ...PROFILE, category: 'shoes', specification_json: SPEC, customer_email: 'buyer@example.com' });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['access_token', 'created_at', 'receipt_id', 'status', 'success']);
      expect(res.body).toMatchObject({ success: true, receipt_id: 'BP20261013001', status: 'new_receipt' });
      expect(JSON.stringify(res.body)).not.toContain('internal-estimate-uuid');
      expect(res.body).not.toHaveProperty('estimate_id');
    });

    it('passes the category, the specification and the trimmed contact details to the service', async () => {
      await post().send({
        ...PROFILE,
        category: 'shoes',
        specification_json: SPEC,
        customer_email: ' buyer@example.com ',
        customer_name: 'Kim'
      });

      expect(create).toHaveBeenCalledWith({
        category: 'shoes',
        specification_json: SPEC,
        customer_email: 'buyer@example.com',
        customer_name: 'Kim',
        customer_phone: undefined,
        company_name: undefined,
        customer_type: 'individual_startup',
        privacy_consent_version: 'dev-draft'
      });
    });

    it('accepts the specification as a JSON string in a multipart form', async () => {
      const res = await withMultipartProfile(
        post()
          .field('category', 'shoes')
          .field('specification_json', JSON.stringify(SPEC))
          .field('customer_phone', '010-1234-5678')
      );

      expect(res.status).toBe(201);
      expect(create.mock.calls[0][0].specification_json).toEqual(SPEC);
    });

    describe('rejections (400 with an error and a timestamp)', () => {
      it('without a category', async () => {
        const res = await post().send({ specification_json: SPEC, customer_email: 'a@b.co' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required field: category');
        expect(Date.parse(res.body.timestamp)).not.toBeNaN();
        expect(create).not.toHaveBeenCalled();
      });

      it('without a specification', async () => {
        const res = await post().send({ category: 'shoes', customer_email: 'a@b.co' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing required field: specification_json');
      });

      it('with an invalid specification: the validator\'s findings come back in details', async () => {
        const res = await post().send({ category: 'shoes', specification_json: { quantity: 0 }, customer_email: 'a@b.co' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid specification_json');
        expect(Array.isArray(res.body.details)).toBe(true);
        expect(res.body.details.length).toBeGreaterThan(0);
        expect(create).not.toHaveBeenCalled();
      });

      it.each([
        ['text that is not JSON', '{not json'],
        ['an empty-looking object that is cut off', '{"quantity": '],
        ['plain words', 'hello']
      ])('with specification_json as %s: 400, not 500', async (_name, text) => {
        const res = await post().send({ category: 'shoes', specification_json: text, customer_email: 'a@b.co' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid specification_json');
        expect(res.body.details).toEqual(['specification_json is not valid JSON']);
        expect(create).not.toHaveBeenCalled();
        expect(JSON.stringify(res.body)).not.toContain(text);
      });

      it('with a broken specification_json in a multipart form: 400, not 500', async () => {
        const res = await request(app)
          .post('/api/estimates')
          .field('category', 'shoes')
          .field('specification_json', '{broken')
          .field('customer_email', 'a@b.co');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid specification_json');
        expect(create).not.toHaveBeenCalled();
      });

      it.each([['a number', '42'], ['an array', '[1,2]'], ['a string', '"text"']])(
        'with a JSON string holding %s instead of an object: 400',
        async (_name, text) => {
          const res = await post().send({ category: 'shoes', specification_json: text, customer_email: 'a@b.co' });

          expect(res.status).toBe(400);
          expect(create).not.toHaveBeenCalled();
        }
      );

      it('with an unknown category', async () => {
        const res = await post().send({ category: 'cars', specification_json: SPEC, customer_email: 'a@b.co' });

        expect(res.status).toBe(400);
        expect(create).not.toHaveBeenCalled();
      });
    });

    describe('with files', () => {
      const attach = () =>
        withMultipartProfile(
          post()
            .field('category', 'shoes')
            .field('specification_json', JSON.stringify(SPEC))
            .field('customer_email', 'buyer@example.com')
        );

      it('returns each file with id, filename, size and status only (never the S3 key)', async () => {
        uploadFiles.mockResolvedValue([
          { id: 'f1', estimateId: 'internal-estimate-uuid', s3Key: 'estimates/x/f1.png', filename: 'logo.png', mimeType: 'image/png', fileSize: 12, status: 'quarantine' }
        ]);

        const res = await attach().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

        expect(res.status).toBe(201);
        expect(res.body.files).toEqual([{ id: 'f1', filename: 'logo.png', size: 12, status: 'quarantine' }]);
        expect(JSON.stringify(res.body)).not.toContain('estimates/x/f1.png');
        expect(uploadFiles).toHaveBeenCalledWith('internal-estimate-uuid', [
          expect.objectContaining({ mimeType: 'image/png', originalFilename: 'logo.png' })
        ]);
      });

      it('rejects a file whose content does not match its type, before anything is created', async () => {
        const res = await attach().attach('files', Buffer.from('this is not a png'), {
          filename: 'logo.png',
          contentType: 'image/png'
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('File validation failed');
        expect(res.body.details[0]).toMatchObject({ filename: 'logo.png' });
        expect(Array.isArray(res.body.details[0].errors)).toBe(true);
        expect(create).not.toHaveBeenCalled();
        expect(uploadFiles).not.toHaveBeenCalled();
      });

      it('keeps the estimate and answers 500 when the files cannot be stored (partial success policy)', async () => {
        uploadFiles.mockRejectedValue(new Error('S3 down'));

        const res = await attach().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('File upload failed');
        expect(JSON.stringify(res.body)).not.toContain('S3 down');
        expect(create).toHaveBeenCalledTimes(1);
      });
    });

    it('answers 500 without internal details when the service fails', async () => {
      create.mockRejectedValue(new Error('relation "estimates" does not exist'));

      const res = await post().send({ ...PROFILE, category: 'shoes', specification_json: SPEC, customer_email: 'a@b.co' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      expect(JSON.stringify(res.body)).not.toContain('relation');
    });
  });

  describe('GET /api/estimates/:receipt_id?token=...', () => {
    const estimate = {
      receipt_id: 'BP20261013001',
      category: 'shoes',
      status: 'new_receipt',
      specification_json: SPEC,
      created_at: '2026-10-13T03:00:00.000Z',
      updated_at: '2026-10-13T03:00:00.000Z'
    };

    it('looks the estimate up with the hash of the token, never with the token itself', async () => {
      lookup.mockResolvedValue(estimate);

      const res = await request(app).get('/api/estimates/BP20261013001?token=my-secret-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(estimate);
      expect(lookup).toHaveBeenCalledWith('BP20261013001', hashEstimateToken('my-secret-token'));
      expect(JSON.stringify(lookup.mock.calls)).not.toContain('my-secret-token');
    });

    it('answers 401 when there is no token, an empty token or a repeated token parameter', async () => {
      for (const url of [
        '/api/estimates/BP20261013001',
        '/api/estimates/BP20261013001?token=',
        '/api/estimates/BP20261013001?token=a&token=b',
        '/api/estimates/BP20261013001?token[x]=y'
      ]) {
        const res = await request(app).get(url);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
      }
      expect(lookup).not.toHaveBeenCalled();
    });

    it('answers 401 for a token that does not belong to this receipt, was used, or has expired', async () => {
      lookup.mockResolvedValue(null);

      const res = await request(app).get('/api/estimates/BP20261013002?token=token-of-another-receipt');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
      expect(res.body).not.toHaveProperty('receipt_id');
    });

    it('answers 404 for a malformed receipt id, without touching the service', async () => {
      for (const id of ['not-a-receipt', 'BP2026101300', 'BP20190101001', 'BP20261301001']) {
        const res = await request(app).get(`/api/estimates/${id}?token=x`);
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Not found');
      }
      expect(lookup).not.toHaveBeenCalled();
    });

    it('answers 500 without internal details when the service fails', async () => {
      lookup.mockRejectedValue(new Error('db password is hunter2'));

      const res = await request(app).get('/api/estimates/BP20261013001?token=x');

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });
  });
});
