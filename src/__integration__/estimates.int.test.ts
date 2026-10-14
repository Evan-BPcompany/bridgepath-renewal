jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { hashEstimateToken } from '../utils/token';
import { formatDate, validateReceiptId } from '../utils/receipt-id';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { SHOE_SPEC, createTestApp, resetData } from './helpers/fixtures';

// The customer API on a real PostgreSQL: create an estimate (one transaction: receipt id,
// estimate, access token, e-mail events), read it back once with the token, and the contact
// policy (an e-mail OR a phone number). S3 and SendGrid are not involved: no files are sent
// and nothing here sends mail; the e-mail events are only rows.
describeIntegration('customer estimates on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let originalAdminEmail: string | undefined;

  const create = (body: Record<string, unknown>) =>
    request(app).post('/api/estimates').send({ category: 'shoes', specification_json: SHOE_SPEC, ...body });
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
      expect(res.body.status).toBe('new_receipt');
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
      expect(res.body).toMatchObject({ receipt_id: receipt, category: 'shoes', status: 'new_receipt' });
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
});
