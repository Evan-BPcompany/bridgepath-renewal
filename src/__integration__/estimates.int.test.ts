jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { hashEstimateToken } from '../utils/token';
import { formatDate, validateReceiptId } from '../utils/receipt-id';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { createApp } from '../app';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';
import * as privacyConsent from '../config/privacyConsent';
import { CUSTOMER_PROFILE, MASTER_ID, SHOE_SPEC, createTestApp, resetData } from './helpers/fixtures';

// The customer API on a real PostgreSQL: create an estimate (one transaction: receipt id,
// estimate, access token, e-mail events), read it back once with the token, and the contact
// policy (an e-mail OR a phone number). S3 and SendGrid are not involved: no files are sent
// and nothing here sends mail; the e-mail events are only rows.
describeIntegration('customer estimates on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let originalAdminEmail: string | undefined;

  const create = (body: Record<string, unknown>) =>
    request(app).post('/api/estimates').send({ ...CUSTOMER_PROFILE, category: 'shoes', specification_json: SHOE_SPEC, ...body });
  const count = async (table: string) => Number((await suite().db(table).count({ n: '*' }).first())?.n);
  const today = () => formatDate(new Date());

  beforeEach(async () => {
    await resetData(suite().db);
    app = createTestApp();
    originalAdminEmail = config.adminNotificationEmail;
    config.adminNotificationEmail = 'owner@bridgepath.test';
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    config.adminNotificationEmail = originalAdminEmail;
    jest.restoreAllMocks();
  });

  describe('creating an estimate', () => {
    it('stores the estimate, a hashed access token and both e-mail events together', async () => {
      const res = await create({ customer_email: 'Buyer@Example.com', customer_name: 'Buyer', company_name: 'Acme' });

      expect(res.status).toBe(201);
      expect(res.body.receipt_id).toMatch(new RegExp(`^BP${today()}\\d{3}$`));
      expect(validateReceiptId(res.body.receipt_id)).toBe(true);
      // The internal status is not shown to the customer (PRD FR-4.9.3); it is stored as new_receipt.
      expect(res.body).not.toHaveProperty('status');
      expect(res.body.message).toBe(CUSTOMER_GUIDANCE_MESSAGE);
      expect(res.body.access_token).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(res.body)).not.toContain('Buyer@Example.com');

      const estimate = await suite().db('estimates').where({ receipt_id: res.body.receipt_id }).first();
      expect(estimate).toMatchObject({
        category: 'shoes',
        status: 'new_receipt',
        customer_name: 'Buyer',
        customer_email: 'Buyer@Example.com',
        customer_phone: null,
        company_name: 'Acme'
      });
      expect(estimate.specification_json).toEqual(SHOE_SPEC);

      const tokens = await suite().db('estimate_access_tokens').where({ estimate_id: estimate.id });
      expect(tokens).toHaveLength(1);
      expect(tokens[0].token).toBe(hashEstimateToken(res.body.access_token));
      expect(tokens[0].token).not.toBe(res.body.access_token);
      expect(tokens[0].receipt_id).toBe(res.body.receipt_id);
      expect(tokens[0].is_used).toBe(false);
      const days = (new Date(tokens[0].expires_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);

      const events = await suite().db('email_events').where({ estimate_id: estimate.id }).orderBy('email_type');
      expect(events.map(e => [e.email_type, e.recipient_email, e.status, e.retry_count])).toEqual([
        ['admin_notification', 'owner@bridgepath.test', 'pending', 0],
        ['receipt', 'Buyer@Example.com', 'pending', 0]
      ]);
      expect(events.map(e => e.idempotency_key).sort()).toEqual([`admin-${estimate.id}`, `receipt-${estimate.id}`]);

      // The customer e-mail shows the fixed guidance and no internal status; the admin one keeps it.
      const receipt = events.find(e => e.email_type === 'receipt');
      const admin = events.find(e => e.email_type === 'admin_notification');
      expect(receipt.body).toContain(CUSTOMER_GUIDANCE_MESSAGE);
      expect(receipt.body).toContain(res.body.receipt_id);
      expect(receipt.body).not.toMatch(/new_receipt|under_review|quoted|negotiating|customer_review|상태/);
      expect(receipt.body).not.toMatch(/빠른 시일|신속|즉시/);
      expect(admin.body).toContain('new_receipt');
    });

    it('numbers consecutive estimates 001, 002, ... of the same day', async () => {
      const first = await create({ customer_email: 'a@example.com' });
      const second = await create({ customer_email: 'b@example.com' });

      expect(first.body.receipt_id).toBe(`BP${today()}001`);
      expect(second.body.receipt_id).toBe(`BP${today()}002`);
    });
  });

  describe('contact policy: an e-mail OR a phone number', () => {
    it('accepts an e-mail only; the receipt mail is queued', async () => {
      const res = await create({ customer_email: 'only-email@example.com' });

      expect(res.status).toBe(201);
      const estimate = await suite().db('estimates').where({ receipt_id: res.body.receipt_id }).first();
      expect(estimate.customer_phone).toBeNull();
      expect(await suite().db('email_events').where({ email_type: 'receipt' })).toHaveLength(1);
    });

    it('accepts a phone number only; no customer mail is queued, the e-mail column stays NULL', async () => {
      const res = await create({ customer_phone: '010-1234-5678' });

      expect(res.status).toBe(201);
      const estimate = await suite().db('estimates').where({ receipt_id: res.body.receipt_id }).first();
      expect(estimate.customer_email).toBeNull();
      expect(estimate.customer_phone).toBe('010-1234-5678');
      expect(await suite().db('email_events').where({ email_type: 'receipt' })).toHaveLength(0);
      expect(await suite().db('email_events').where({ email_type: 'admin_notification' })).toHaveLength(1);
    });

    it('accepts both', async () => {
      const res = await create({ customer_email: 'both@example.com', customer_phone: '010-1234-5678' });

      expect(res.status).toBe(201);
    });

    it('refuses neither (400) and stores nothing, not even a receipt number', async () => {
      const res = await create({ customer_name: 'No contact' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing required contact: customer_email or customer_phone');
      expect(await count('estimates')).toBe(0);
      expect(await count('receipt_sequence')).toBe(0);
    });

    it('refuses an invalid specification without storing anything', async () => {
      const res = await create({ customer_email: 'a@example.com', specification_json: { quantity: 0 } });

      expect(res.status).toBe(400);
      expect(await count('estimates')).toBe(0);
    });

    it('refuses a specification that is not valid JSON with 400', async () => {
      const res = await create({ customer_email: 'a@example.com', specification_json: '{broken' });

      expect(res.status).toBe(400);
      expect(await count('estimates')).toBe(0);
    });
  });

  describe('all or nothing', () => {
    it('a failing e-mail event rolls back the estimate, the token and the receipt number', async () => {
      // recipient_email is VARCHAR(100): this notification address makes the insert fail.
      config.adminNotificationEmail = `${'x'.repeat(95)}@example.com`;

      const res = await create({ customer_email: 'a@example.com' });

      expect(res.status).toBe(500);
      expect(await count('estimates')).toBe(0);
      expect(await count('estimate_access_tokens')).toBe(0);
      expect(await count('email_events')).toBe(0);
      expect(await count('receipt_sequence')).toBe(0);

      // The number was not used up: the next estimate gets 001.
      config.adminNotificationEmail = 'owner@bridgepath.test';
      const next = await create({ customer_email: 'a@example.com' });
      expect(next.body.receipt_id).toBe(`BP${today()}001`);
    });
  });

  describe('reading an estimate with the access token', () => {
    const createdEstimate = async () => {
      const res = await create({ customer_email: 'reader@example.com', customer_phone: '010-1111-2222', customer_name: 'Reader' });
      return { receipt: res.body.receipt_id as string, token: res.body.access_token as string };
    };
    const read = (receipt: string, token?: string) =>
      request(app).get(`/api/estimates/${receipt}`).query(token === undefined ? {} : { token });

    it('returns the estimate once, without personal data, and marks the token used', async () => {
      const { receipt, token } = await createdEstimate();

      const res = await read(receipt, token);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ receipt_id: receipt, category: 'shoes', message: CUSTOMER_GUIDANCE_MESSAGE });
      // The internal status is not part of the customer's answer (PRD FR-4.9.3).
      expect(Object.keys(res.body)).not.toContain('status');
      expect(res.body).not.toHaveProperty('status');
      expect(JSON.stringify(res.body)).not.toContain('new_receipt');
      expect(res.body.specification_json).toEqual(SHOE_SPEC);
      expect(JSON.stringify(res.body)).not.toMatch(/reader@example|010-1111|Reader/);

      const row = await suite().db('estimate_access_tokens').where({ receipt_id: receipt }).first();
      expect(row.is_used).toBe(true);
      expect(row.visit_count).toBe(1);
      expect(row.visited_at).not.toBeNull();
    });

    it('the same token cannot be used twice', async () => {
      const { receipt, token } = await createdEstimate();

      expect((await read(receipt, token)).status).toBe(200);
      expect((await read(receipt, token)).status).toBe(401);
    });

    it('two parallel reads with the same token: exactly one succeeds', async () => {
      const { receipt, token } = await createdEstimate();

      const results = await Promise.all([read(receipt, token), read(receipt, token)]);

      expect(results.map(r => r.status).sort()).toEqual([200, 401]);
      expect((await suite().db('estimate_access_tokens').where({ receipt_id: receipt }).first()).visit_count).toBe(1);
    });

    it('an expired token is refused and stays unused', async () => {
      const { receipt, token } = await createdEstimate();
      await suite().db('estimate_access_tokens').update({
        expires_at: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'")
      });

      expect((await read(receipt, token)).status).toBe(401);
      expect((await suite().db('estimate_access_tokens').first()).is_used).toBe(false);
    });

    it('a wrong token, a missing token and a token of another estimate are refused', async () => {
      const first = await createdEstimate();
      const second = await createdEstimate();

      expect((await read(first.receipt, 'f'.repeat(64))).status).toBe(401);
      expect((await read(first.receipt)).status).toBe(401);
      expect((await read(first.receipt, second.token)).status).toBe(401);
      // None of the refused attempts used up the real token.
      expect((await read(first.receipt, first.token)).status).toBe(200);
    });

    it('an unknown or malformed receipt id answers 404', async () => {
      expect((await read('BP20200101999', 'a'.repeat(64))).status).toBe(401);
      expect((await read('not-a-receipt', 'a'.repeat(64))).status).toBe(404);
    });
  });

  describe('many customers at once', () => {
    // Every request must succeed with its own number, and the rows must agree with the answers.
    it.each([[5], [20]])('%i parallel requests: all created, numbers 1..N without a gap or a duplicate', async n => {
      const results = await Promise.all(
        Array.from({ length: n }, (_, i) => create({ customer_email: `parallel${i}@example.com` }))
      );

      expect(results.map(r => r.status)).toEqual(Array(n).fill(201));
      const ids = results.map(r => r.body.receipt_id as string);
      expect(new Set(ids).size).toBe(n);
      const sequences = ids.map(id => Number(id.slice(-3))).sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: n }, (_, i) => i + 1));

      expect(await count('estimates')).toBe(n);
      expect(await count('estimate_access_tokens')).toBe(n);
      expect(await count('email_events')).toBe(n * 2);
      expect(await suite().db('receipt_sequence').select('last_sequence')).toEqual([{ last_sequence: n }]);
      // Nothing needed a retry.
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('customer type and privacy consent', () => {
    const SECONDS = 60;
    const rowOf = async (receiptId: string) => suite().db('estimates').where({ receipt_id: receiptId }).first();
    // The consent time must be the database's own time: close to now() of the same server.
    const closeToDatabaseNow = async (receiptId: string): Promise<boolean> => {
      const result = await suite().db.raw(
        `SELECT privacy_consent_at BETWEEN now() - make_interval(secs => ?) AND now() + make_interval(secs => 1) AS close
         FROM estimates WHERE receipt_id = ?`,
        [SECONDS, receiptId]
      );
      return result.rows[0].close === true;
    };
    const untouched = async () => {
      expect(await count('estimates')).toBe(0);
      expect(await count('estimate_access_tokens')).toBe(0);
      expect(await count('email_events')).toBe(0);
      expect(await suite().db('receipt_sequence').select('last_sequence')).toEqual([]);
    };

    it('stores the customer type, the consent version and the database time of the request (JSON)', async () => {
      const res = await create({ customer_type: 'business_brand', company_name: 'Acme', customer_email: 'biz@example.com' });

      expect(res.status).toBe(201);
      const row = await rowOf(res.body.receipt_id);
      expect(row).toMatchObject({
        customer_type: 'business_brand',
        customer_name: 'Kim',
        company_name: 'Acme',
        privacy_consent_version: 'dev-draft'
      });
      expect(await closeToDatabaseNow(res.body.receipt_id)).toBe(true);
    });

    it('stores the same for multipart/form-data, where the consent is the text "true"', async () => {
      const res = await request(app)
        .post('/api/estimates')
        .field('category', 'shoes')
        .field('specification_json', JSON.stringify(SHOE_SPEC))
        .field('customer_phone', '010-1234-5678')
        .field('customer_type', 'individual_startup')
        .field('customer_name', 'Lee')
        .field('privacy_consent', 'true')
        .field('privacy_consent_version', 'dev-draft');

      expect(res.status).toBe(201);
      const row = await rowOf(res.body.receipt_id);
      expect(row).toMatchObject({
        customer_type: 'individual_startup',
        customer_name: 'Lee',
        company_name: null,
        privacy_consent_version: 'dev-draft'
      });
      expect(await closeToDatabaseNow(res.body.receipt_id)).toBe(true);
    });

    it('ignores a consent time sent by the client', async () => {
      const res = await create({ customer_email: 'ignore@example.com', privacy_consent_at: '1999-01-01T00:00:00Z', consent_at: '1999-01-01T00:00:00Z', created_at: '1999-01-01T00:00:00Z' });

      expect(res.status).toBe(201);
      const row = await rowOf(res.body.receipt_id);
      expect(new Date(row.privacy_consent_at).getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(await closeToDatabaseNow(res.body.receipt_id)).toBe(true);
    });

    it.each([
      ['no customer type', { customer_type: undefined }],
      ['an unknown customer type', { customer_type: 'business' }],
      ['no name', { customer_name: undefined }],
      ['a business without a company name', { customer_type: 'business_brand', company_name: undefined }],
      ['no consent', { privacy_consent: undefined }],
      ['consent false', { privacy_consent: false }],
      ['consent as the JSON text "true"', { privacy_consent: 'true' }],
      ['no consent version', { privacy_consent_version: undefined }],
      ['an unknown consent version', { privacy_consent_version: 'v999' }],
      ['no contact', { customer_email: undefined }]
    ])('a request with %s is refused with 400 and nothing is written: no estimate, no number, no e-mail', async (_name, change) => {
      const res = await create({ customer_email: 'x@example.com', ...change });

      expect(res.status).toBe(400);
      await untouched();
    });

    it('a refused request does not use up a receipt number: the next valid request is number 1', async () => {
      expect((await create({ privacy_consent: false })).status).toBe(400);
      const ok = await create({ customer_email: 'next@example.com' });

      expect(ok.status).toBe(201);
      expect(Number(ok.body.receipt_id.slice(-3))).toBe(1);
    });

    it('the customer lookup shows neither personal data nor the consent', async () => {
      const created = await create({ customer_email: 'look@example.com', customer_name: 'Secret Person' });
      const res = await request(app)
        .get(`/api/estimates/${created.body.receipt_id}`)
        .query({ token: created.body.access_token });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'category',
        'created_at',
        'message',
        'receipt_id',
        'specification_json',
        'updated_at'
      ]);
      expect(res.body.message).toBe(CUSTOMER_GUIDANCE_MESSAGE);
      expect(JSON.stringify(res.body)).not.toMatch(/Secret Person|look@example|consent|customer_type|new_receipt/);
    });

    describe('per environment', () => {
      const originalNodeEnv = config.nodeEnv;
      afterEach(() => {
        config.nodeEnv = originalNodeEnv;
      });

      it('production with no approved consent version answers 503 and stores nothing', async () => {
        config.nodeEnv = 'production';

        const res = await create({ customer_email: 'prod@example.com' });

        expect(res.status).toBe(503);
        expect(res.body.code).toBe('PRIVACY_CONSENT_NOT_CONFIGURED');
        await untouched();
      });

      it('production with an approved version refuses dev-draft (400, nothing stored) and stores the approved one', async () => {
        config.nodeEnv = 'production';
        jest.spyOn(privacyConsent, 'getAcceptedConsentVersions').mockReturnValue(['2026-v1']);

        const refused = await create({ customer_email: 'prod@example.com', privacy_consent_version: 'dev-draft' });
        expect(refused.status).toBe(400);
        await untouched();

        const ok = await create({ customer_email: 'prod@example.com', privacy_consent_version: '2026-v1' });
        expect(ok.status).toBe(201);
        expect((await rowOf(ok.body.receipt_id)).privacy_consent_version).toBe('2026-v1');
      });
    });
  });

  describe('rate limits of the public API (in process memory, per IP)', () => {
    const HOUR = 60 * 60 * 1000;
    const QUARTER = 15 * 60 * 1000;
    const BIG = { windowMs: HOUR, max: 100_000 };
    const limited = (overrides: Record<string, { windowMs: number; max: number }>): Express =>
      createApp({
        rateLimits: { login: BIG, api: BIG, mutation: BIG, password: BIG, estimateCreate: BIG, estimateRead: BIG, estimatePreview: BIG, ...overrides }
      });
    const sendTo = (target: Express, email: string) =>
      request(target).post('/api/estimates').send({ ...CUSTOMER_PROFILE, category: 'shoes', specification_json: SHOE_SPEC, customer_email: email });

    it('the requests over the limit get 429 and consume no receipt number, estimate or e-mail event', async () => {
      const target = limited({ estimateCreate: { windowMs: HOUR, max: 3 } });

      const results = [];
      for (let i = 0; i < 5; i += 1) {
        results.push(await sendTo(target, `limit${i}@example.com`));
      }

      expect(results.map(r => r.status)).toEqual([201, 201, 201, 429, 429]);
      expect(Number(results[3].headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(results[3].headers['ratelimit']).toBeDefined();
      expect(results.slice(0, 3).map(r => Number(r.body.receipt_id.slice(-3)))).toEqual([1, 2, 3]);
      expect(await count('estimates')).toBe(3);
      expect(await count('estimate_access_tokens')).toBe(3);
      expect(await count('email_events')).toBe(6);
      expect(await suite().db('receipt_sequence').select('last_sequence')).toEqual([{ last_sequence: 3 }]);
    });

    it('20 parallel requests with a limit of 10: exactly 10 are created (numbers 1..10) and 10 are refused', async () => {
      const target = limited({ estimateCreate: { windowMs: HOUR, max: 10 } });

      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => sendTo(target, `burst${i}@example.com`)));

      expect(results.filter(r => r.status === 201)).toHaveLength(10);
      expect(results.filter(r => r.status === 429)).toHaveLength(10);
      const numbers = results.filter(r => r.status === 201).map(r => Number(r.body.receipt_id.slice(-3))).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await count('estimates')).toBe(10);
      expect(await suite().db('receipt_sequence').select('last_sequence')).toEqual([{ last_sequence: 10 }]);
    });

    it('reading: the first lookup works once, refused requests do not touch the one-time token', async () => {
      const created = await sendTo(createTestApp(), 'reader@example.com');
      expect(created.status).toBe(201);
      const target = limited({ estimateRead: { windowMs: QUARTER, max: 2 } });
      const url = `/api/estimates/${created.body.receipt_id}`;
      const token = created.body.access_token as string;

      expect((await request(target).get(url).query({ token })).status).toBe(200);
      // The token was used up by the first lookup; the second request is a normal 401.
      expect((await request(target).get(url).query({ token })).status).toBe(401);
      const refused = await request(target).get(url).query({ token });

      expect(refused.status).toBe(429);
      const row = await suite().db('estimate_access_tokens').where({ receipt_id: created.body.receipt_id }).first();
      expect(row.is_used).toBe(true);
      // Only the first lookup counted as a visit; the second matched nothing and the refused one never reached the service.
      expect(Number(row.visit_count)).toBe(1);
    });

    it('refused public requests leave the admin lockout counter and the admin login alone', async () => {
      const target = limited({ estimateCreate: { windowMs: HOUR, max: 1 }, estimateRead: { windowMs: QUARTER, max: 1 } });
      await sendTo(target, 'first@example.com');
      for (let i = 0; i < 5; i += 1) {
        expect((await sendTo(target, `more${i}@example.com`)).status).toBe(429);
        expect((await request(target).get('/api/estimates/BP20261013001').query({ token: 'a'.repeat(64) })).status).toBeGreaterThanOrEqual(401);
      }

      const admin = await suite().db('admin_users').where({ id: MASTER_ID }).first();
      expect(admin.failed_login_attempts).toBe(0);
      expect(admin.locked_until).toBeNull();
      const login = await request(target).post('/admin/login').send({ username: 'master', password: 'Correct-Horse-9' });
      expect(login.status).toBe(200);
    });
  });
});
