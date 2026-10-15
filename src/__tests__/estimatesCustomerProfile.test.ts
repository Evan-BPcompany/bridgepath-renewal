jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({ uploadMultipleFilesWithMetadata: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { createApp } from '../app';
import * as privacyConsent from '../config/privacyConsent';
import { PROFILE, SERVICE_PROFILE, withMultipartProfile } from './helpers/customerFixtures';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../services/fileService';
import { getPool } from '../config/database';
import { createFakeDb } from './helpers/adminTestUtils';

const create = createEstimate as jest.Mock;
const lookup = getEstimateByReceiptId as jest.Mock;
const upload = uploadMultipleFilesWithMetadata as jest.Mock;

const SPEC = { schema_version: '1.0', shoe_type: 'Running', material: 'Mesh', size_range: '240-250', quantity: 500 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const CREATED = {
  success: true,
  receipt_id: 'BP20261013001',
  estimate_id: 'internal',
  status: 'new_receipt',
  access_token: 'a'.repeat(64),
  created_at: '2026-10-13T03:00:00.000Z'
};
const PERSONAL = 'Secret Person';

// POST /api/estimates with customer type, name, company and privacy consent, over HTTP with the
// service replaced by a mock: what reaches the service, and what never gets that far.
describe('customer type and privacy consent on POST /api/estimates', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  const originalNodeEnv = config.nodeEnv;

  const json = (body: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/estimates')
      .send({ category: 'shoes', specification_json: SPEC, customer_email: 'buyer@example.com', ...PROFILE, ...body });
  const form = () =>
    request(app)
      .post('/api/estimates')
      .field('category', 'shoes')
      .field('specification_json', JSON.stringify(SPEC))
      .field('customer_email', 'buyer@example.com');
  const sentToService = () => create.mock.calls[0][0];

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp({ rateLimits: { estimateCreate: { windowMs: 3600000, max: 100000 } } });
    create.mockReset().mockResolvedValue(CREATED);
    lookup.mockReset().mockResolvedValue(null);
    upload.mockReset().mockResolvedValue([]);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    config.nodeEnv = originalNodeEnv;
    jest.restoreAllMocks();
  });

  describe('JSON requests', () => {
    it('passes the customer type and the consent version to the service, and nothing else about the consent', async () => {
      const res = await json({ customer_type: 'business_brand', company_name: 'Acme' });

      expect(res.status).toBe(201);
      expect(sentToService()).toMatchObject({
        customer_type: 'business_brand',
        customer_name: 'Kim',
        company_name: 'Acme',
        privacy_consent_version: 'dev-draft'
      });
      // The consent itself is a precondition, not data to pass on; the time is the database's.
      expect(sentToService()).not.toHaveProperty('privacy_consent');
      expect(sentToService()).not.toHaveProperty('privacy_consent_at');
    });

    it('answers 400 with the field names for each missing or wrong value, and calls nothing', async () => {
      const res = await json({
        customer_type: 'nope',
        customer_name: undefined,
        privacy_consent: false,
        privacy_consent_version: 'unknown'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid customer information');
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'customer_name',
        'customer_type',
        'privacy_consent',
        'privacy_consent_version'
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it('requires company_name for business_brand but not for individual_startup', async () => {
      const refused = await json({ customer_type: 'business_brand' });
      expect(refused.status).toBe(400);
      expect(refused.body.details).toEqual([
        { field: 'company_name', message: 'is required for customer_type business_brand' }
      ]);

      expect((await json({ customer_type: 'individual_startup' })).status).toBe(201);
    });

    it('does not accept the text "true" in JSON: the consent must be the boolean true', async () => {
      const res = await json({ privacy_consent: 'true' });

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ field: 'privacy_consent', message: 'must be true' }]);
    });

    it('keeps the old contact message when the contact is the only thing missing', async () => {
      const res = await json({ customer_email: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing required contact: customer_email or customer_phone');
    });
  });

  describe('multipart/form-data requests (same rules)', () => {
    it('accepts the form fields, turning the text "true" into the consent', async () => {
      const res = await withMultipartProfile(form());

      expect(res.status).toBe(201);
      expect(sentToService()).toMatchObject({
        customer_type: 'individual_startup',
        customer_name: 'Kim',
        privacy_consent_version: 'dev-draft'
      });
    });

    it.each(['false', 'True', 'TRUE', '1', 'on', 'yes', ''])('refuses privacy_consent=%j', async text => {
      const res = await form()
        .field('customer_type', 'individual_startup')
        .field('customer_name', 'Kim')
        .field('privacy_consent', text)
        .field('privacy_consent_version', 'dev-draft');

      expect(res.status).toBe(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(['privacy_consent']);
      expect(create).not.toHaveBeenCalled();
    });

    it('requires the same fields as JSON: type, name, company for business_brand, consent, version', async () => {
      const none = await form();
      expect(none.status).toBe(400);
      expect(none.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'customer_name',
        'customer_type',
        'privacy_consent',
        'privacy_consent_version'
      ]);

      const business = await form()
        .field('customer_type', 'business_brand')
        .field('customer_name', 'Kim')
        .field('privacy_consent', 'true')
        .field('privacy_consent_version', 'dev-draft');
      expect(business.body.details).toEqual([
        { field: 'company_name', message: 'is required for customer_type business_brand' }
      ]);
    });

    it('refuses before storing anything when files are attached but the consent is missing', async () => {
      const res = await form()
        .field('customer_type', 'individual_startup')
        .field('customer_name', 'Kim')
        .attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(db.pool.connect).not.toHaveBeenCalled();
    });
  });

  describe('the consent time belongs to the server', () => {
    it.each([
      ['privacy_consent_at', '1999-01-01T00:00:00Z'],
      ['consent_at', '1999-01-01T00:00:00Z'],
      ['consented_at', 'yesterday'],
      ['created_at', '1999-01-01T00:00:00Z']
    ])('ignores a client-supplied %s (JSON)', async (field, value) => {
      const res = await json({ [field]: value });

      expect(res.status).toBe(201);
      expect(JSON.stringify(sentToService())).not.toContain(value);
      expect(Object.keys(sentToService())).not.toContain(field);
    });

    it('ignores a client-supplied consent time in a form as well', async () => {
      const res = await withMultipartProfile(form()).field('privacy_consent_at', '1999-01-01T00:00:00Z');

      expect(res.status).toBe(201);
      expect(JSON.stringify(sentToService())).not.toContain('1999');
    });
  });

  describe('dev-draft per environment', () => {
    it.each(['development', 'test'] as const)('is accepted in %s', async env => {
      config.nodeEnv = env;

      expect((await json({ privacy_consent_version: 'dev-draft' })).status).toBe(201);
    });

    it('is refused in production once a version is approved: 400, and an approved version is accepted', async () => {
      config.nodeEnv = 'production';
      jest.spyOn(privacyConsent, 'getAcceptedConsentVersions').mockReturnValue(['2026-v1']);

      const devDraft = await json({ privacy_consent_version: 'dev-draft' });
      expect(devDraft.status).toBe(400);
      expect(devDraft.body.details).toEqual([
        { field: 'privacy_consent_version', message: 'is not an accepted consent version' }
      ]);
      expect(create).not.toHaveBeenCalled();

      const approved = await json({ privacy_consent_version: '2026-v1' });
      expect(approved.status).toBe(201);
      expect(sentToService().privacy_consent_version).toBe('2026-v1');
    });

    it('production with no approved version at all refuses every request with 503, before anything else', async () => {
      config.nodeEnv = 'production';

      for (const send of [
        () => json(),
        () => json({ privacy_consent_version: 'dev-draft' }),
        () => withMultipartProfile(form()),
        () => request(app).post('/api/estimates').send({})
      ]) {
        const res = await send();
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({
          error: 'Estimate intake is not available yet',
          code: 'PRIVACY_CONSENT_NOT_CONFIGURED'
        });
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(create).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(db.pool.connect).not.toHaveBeenCalled();
      expect(db.state.queries).toHaveLength(0);
    });

    it('the 503 does not affect the rest of the API: health, admin and the customer lookup still answer', async () => {
      config.nodeEnv = 'production';

      expect((await request(app).get('/health')).status).toBe(200);
      expect((await request(app).get('/admin/estimates')).status).toBe(401);
      const lookupResult = await request(app).get('/api/estimates/BP20261013001').query({ token: 'a'.repeat(64) });
      expect(lookupResult.status).toBe(401);
    });
  });

  describe('personal data and consent stay out of logs and customer responses', () => {
    it('writes no name, e-mail, company or consent value to the log, for accepted and refused requests', async () => {
      await json({ customer_name: PERSONAL, company_name: 'Hidden Co', customer_email: 'hidden@example.com' });
      await json({ customer_name: PERSONAL, customer_email: 'hidden@example.com', privacy_consent: false });
      await json({ customer_name: PERSONAL, customer_type: 'nope', privacy_consent_version: 'weird-version' });

      const logged = JSON.stringify([
        ...(logger.info as jest.Mock).mock.calls,
        ...(logger.warn as jest.Mock).mock.calls,
        ...(logger.error as jest.Mock).mock.calls
      ]);
      for (const secret of [PERSONAL, 'Hidden Co', 'hidden@example.com', 'weird-version']) {
        expect(logged).not.toContain(secret);
      }
    });

    it('the 201 answer carries no customer type, name, consent or version', async () => {
      const res = await json();

      expect(Object.keys(res.body).sort()).toEqual(['access_token', 'created_at', 'receipt_id', 'status', 'success']);
      expect(JSON.stringify(res.body)).not.toMatch(/customer_type|consent|individual_startup|dev-draft/);
    });

    it('the customer lookup shows no personal data and no consent', async () => {
      lookup.mockResolvedValue({
        receipt_id: 'BP20261013001',
        category: 'shoes',
        status: 'new_receipt',
        specification_json: SPEC,
        created_at: '2026-10-13T03:00:00.000Z',
        updated_at: '2026-10-13T03:00:00.000Z'
      });

      const res = await request(app).get('/api/estimates/BP20261013001').query({ token: 'a'.repeat(64) });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'category',
        'created_at',
        'receipt_id',
        'specification_json',
        'status',
        'updated_at'
      ]);
    });
  });

  it('SERVICE_PROFILE fixture matches what the route hands to the service', async () => {
    await json();

    expect(sentToService()).toMatchObject(SERVICE_PROFILE);
  });
});
