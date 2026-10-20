jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({ storeFiles: jest.fn(), discardStoredFiles: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { createApp } from '../app';
import { PROFILE, withMultipartProfile } from './helpers/customerFixtures';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { discardStoredFiles, storeFiles } from '../services/fileService';
import { hashEstimateToken } from '../utils/token';

const create = createEstimate as jest.Mock;
const lookup = getEstimateByReceiptId as jest.Mock;
const uploadFiles = storeFiles as jest.Mock;
const discard = discardStoredFiles as jest.Mock;

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
    discard.mockReset();
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
      expect(Object.keys(res.body).sort()).toEqual(['access_token', 'created_at', 'message', 'receipt_id', 'success']);
      expect(res.body).toMatchObject({ success: true, receipt_id: 'BP20261013001', message: CUSTOMER_GUIDANCE_MESSAGE });
      // The service result still carries the internal status; the customer must not get it.
      expect(res.body).not.toHaveProperty('status');
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
        privacy_consent_version: 'dev-draft',
        estimate_id: undefined,
        files: []
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
        // The files are stored first, under the id the estimate is then created with.
        const estimateId = uploadFiles.mock.calls[0][0];
        expect(estimateId).toMatch(/^[0-9a-f-]{36}$/);
        expect(uploadFiles).toHaveBeenCalledWith(estimateId, [
          expect.objectContaining({ mimeType: 'image/png', originalFilename: 'logo.png' })
        ]);
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ estimate_id: estimateId, files: [expect.objectContaining({ id: 'f1' })] })
        );
        expect(uploadFiles.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
        expect(discard).not.toHaveBeenCalled();
      });

      it('creates a request without files with no estimate id of its own and no files', async () => {
        await post().send({ ...PROFILE, category: 'shoes', specification_json: SPEC, customer_email: 'buyer@example.com' });

        expect(uploadFiles).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ estimate_id: undefined, files: [] }));
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

      // PRD FR-4.7: a request whose attachment failed is not accepted: no estimate, no receipt
      // number, so that trying again cannot make a second request.
      it('saves nothing and gives no receipt number when the files cannot be stored', async () => {
        uploadFiles.mockRejectedValue(new Error('S3 down'));

        const res = await attach().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('File upload failed');
        expect(res.body.code).toBe('FILE_UPLOAD_FAILED');
        expect(res.body.receipt_id).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain('S3 down');
        expect(create).not.toHaveBeenCalled();
      });

      it('removes the stored files when the estimate cannot be saved', async () => {
        const stored = [{ id: 'f1', estimateId: 'x', s3Key: 'estimates/x/f1.png', filename: 'logo.png', mimeType: 'image/png', fileSize: 12, status: 'quarantine' }];
        uploadFiles.mockResolvedValue(stored);
        create.mockRejectedValue(new Error('deadlock detected'));

        const res = await attach().attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

        expect(res.status).toBe(500);
        expect(res.body.receipt_id).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain('deadlock');
        expect(discard).toHaveBeenCalledWith(stored);
      });

      describe('what is refused before anything is stored (400, never 500)', () => {
        const expectRefused = (res: request.Response, message: RegExp) => {
          expect(res.status).toBe(400);
          expect(res.body.error).toBe('File validation failed');
          expect(JSON.stringify(res.body.details)).toMatch(message);
          expect(uploadFiles).not.toHaveBeenCalled();
          expect(create).not.toHaveBeenCalled();
        };

        it('a type that is not allowed (GIF), named with its file', async () => {
          const res = await attach().attach('files', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });

          expectRefused(res, /MIME type image\/gif is not allowed/);
          expect(res.body.details[0].filename).toBe('a.gif');
        });

        it('more than 5 files', async () => {
          let req = attach();
          for (let i = 0; i < 6; i += 1) {
            req = req.attach('files', PNG, { filename: `f${i}.png`, contentType: 'image/png' });
          }

          expectRefused(await req, /Too many files: at most 5/);
        });

        it('a file over 10 MB', async () => {
          const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);

          expectRefused(await attach().attach('files', big, { filename: 'big.png', contentType: 'image/png' }), /File size exceeds 10MB/);
        });

        it('files that are more than 30 MB together', async () => {
          const nearLimit = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
          let req = attach();
          for (let i = 0; i < 4; i += 1) {
            req = req.attach('files', nearLimit, { filename: `f${i}.png`, contentType: 'image/png' });
          }

          expectRefused(await req, /Total file size exceeds 30MB/);
        });

        it('a Korean file name reaches the storage as it was written, not as mojibake', async () => {
          uploadFiles.mockResolvedValue([]);

          await attach().attach('files', PNG, { filename: '내 로고 (최종).png', contentType: 'image/png' });

          expect(uploadFiles.mock.calls[0][1].map((file: { originalFilename: string }) => file.originalFilename)).toEqual([
            '내 로고 (최종).png'
          ]);
        });

        it('a WEBP file is accepted (PRD FR-2.6)', async () => {
          uploadFiles.mockResolvedValue([]);
          const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8)]);

          const res = await attach().attach('files', webp, { filename: 'photo.webp', contentType: 'image/webp' });

          expect(res.status).toBe(201);
        });

        it('a WEBP-named file that is really a RIFF audio file', async () => {
          const wave = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WAVE'), Buffer.alloc(8)]);

          expectRefused(await attach().attach('files', wave, { filename: 'photo.webp', contentType: 'image/webp' }), /magic bytes/);
        });
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
      // The service result below still has an internal status; the answer must not.
      const { status: _internal, ...visible } = estimate;
      expect(res.body).toEqual({ ...visible, message: CUSTOMER_GUIDANCE_MESSAGE });
      expect(res.body).not.toHaveProperty('status');
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
