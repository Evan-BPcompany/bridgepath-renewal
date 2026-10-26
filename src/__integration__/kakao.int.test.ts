jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerMailer', () => ({
  ...jest.requireActual('../services/customerMailer'),
  sendCodeEmail: jest.fn().mockResolvedValue(undefined)
}));

import request from 'supertest';
import type { Express } from 'express';
import { config } from '../config/env';
import { getPool } from '../config/database';
import { processPendingKakaoEvents, queueKakaoInTransaction, setKakaoSender } from '../services/kakaoService';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { createTestApp, insertEstimate, resetData } from './helpers/fixtures';

// The KakaoTalk notices on a real PostgreSQL: the outbox (written with the thing it tells about, once),
// who gets one (agreed, a Korean mobile number, active), the retries, and the consent endpoint.
describeIntegration('the KakaoTalk notices on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let saved: boolean;
  let app: Express;
  const send = jest.fn();

  const customer = async (over: Record<string, unknown> = {}): Promise<string> => {
    const [row] = await suite()
      .db('customers')
      .insert({ email: `c${Math.random().toString(36).slice(2)}@example.com`, phone: '010-1234-5678', kakao_notify_consent_at: new Date(), is_active: true, ...over })
      .returning('id');
    return row.id as string;
  };
  const queue = async (customerId: string | null, key = 'k1', estimate?: { id: string; receipt_id: string }): Promise<boolean> => {
    const target = estimate ?? (await insertEstimate(suite().db));
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const queued = await queueKakaoInTransaction(client, { customerId, estimateId: target.id, template: 'receipt', receiptId: target.receipt_id, key });
      await client.query('COMMIT');
      return queued;
    } finally {
      client.release();
    }
  };
  const events = () => suite().db('kakao_events').orderBy('created_at');

  beforeAll(() => {
    saved = config.kakao.enabled;
    app = createTestApp();
  });
  afterAll(() => {
    config.kakao.enabled = saved;
  });
  beforeEach(async () => {
    config.kakao.enabled = true;
    send.mockReset().mockResolvedValue('agency-1');
    setKakaoSender({ send });
    await resetData(suite().db);
    await suite().db('kakao_events').del();
  });

  it('writes one notice with the normalised number, and the same key again writes nothing more', async () => {
    const id = await customer();
    const estimate = await insertEstimate(suite().db);

    expect(await queue(id, 'same', estimate)).toBe(true);
    expect(await queue(id, 'same', estimate)).toBe(false);

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient_phone: '01012345678', template_code: 'receipt', status: 'pending', customer_id: id });
    expect(rows[0].variables.receipt_id).toBe(estimate.receipt_id);
  });

  it('writes nothing for a customer who has not agreed, has a landline, is switched off, or when notices are off', async () => {
    expect(await queue(await customer({ kakao_notify_consent_at: null }))).toBe(false);
    expect(await queue(await customer({ phone: '02-123-4567' }), 'k2')).toBe(false);
    expect(await queue(await customer({ is_active: false }), 'k3')).toBe(false);
    expect(await queue(null, 'k4')).toBe(false);
    config.kakao.enabled = false;
    expect(await queue(await customer(), 'k5')).toBe(false);

    expect(await events()).toHaveLength(0);
  });

  it('is written in the transaction of the caller: a rollback takes it away with the rest', async () => {
    const id = await customer();
    const estimate = await insertEstimate(suite().db);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await queueKakaoInTransaction(client, { customerId: id, estimateId: estimate.id, template: 'quote_published', receiptId: estimate.receipt_id, key: 'rolled' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await events()).toHaveLength(0);
  });

  it('sends it with the worker and marks it sent', async () => {
    await queue(await customer());

    expect(await processPendingKakaoEvents()).toBe(1);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ phone: '01012345678', templateCode: 'receipt' }));
    expect((await events())[0]).toMatchObject({ status: 'sent', provider_message_id: 'agency-1' });
    expect((await events())[0].sent_at).not.toBeNull();
    expect(await processPendingKakaoEvents()).toBe(0);
  });

  it('retries a failure after a delay (not at once), and gives up after three retries', async () => {
    send.mockRejectedValue(new Error('agency down'));
    await queue(await customer());

    await processPendingKakaoEvents();
    expect((await events())[0]).toMatchObject({ status: 'pending', retry_count: 1, last_error: 'agency down' });
    expect(await processPendingKakaoEvents()).toBe(0); // not due yet

    for (const expected of [2, 3]) {
      await suite().db('kakao_events').update({ next_retry_at: new Date(Date.now() - 1000) });
      await processPendingKakaoEvents();
      expect((await events())[0].retry_count).toBe(expected);
    }
    await suite().db('kakao_events').update({ next_retry_at: new Date(Date.now() - 1000) });
    await processPendingKakaoEvents();

    expect((await events())[0]).toMatchObject({ status: 'failed', last_error: 'agency down' });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('puts back an event that was stuck in sending by a worker that died', async () => {
    await queue(await customer());
    await suite().db('kakao_events').update({ status: 'sending', updated_at: new Date(Date.now() - 10 * 60 * 1000) });

    await processPendingKakaoEvents(); // recovers it, due in a minute
    expect((await events())[0].status).toBe('pending');
    await suite().db('kakao_events').update({ next_retry_at: new Date(Date.now() - 1000) });
    expect(await processPendingKakaoEvents()).toBe(1);
    expect((await events())[0].status).toBe('sent');
  });

  it('keeps the notice (customer removed) when the account is deleted, and refuses a template that does not exist', async () => {
    const id = await customer();
    await queue(id);
    await suite().db('customers').where({ id }).del();

    expect((await events())[0].customer_id).toBeNull();
    await expect(
      suite().db('kakao_events').insert({ recipient_phone: '01012345678', template_code: 'nope', idempotency_key: 'x' })
    ).rejects.toThrow();
  });

  describe('the consent of a customer, through the API', () => {
    const SIGNUP = { email: 'kakao@example.com', password: 'abcdefg1', name: 'Kim', phone: '010-1234-5678', privacy_consent: true, privacy_consent_version: 'dev-draft' };
    const cookieOf = (res: request.Response): string => {
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      return cookies.map(c => c.split(';')[0]).find(c => c.startsWith('bp_session=')) ?? '';
    };

    it('is off after a sign-up without the box, on with it, and can be taken back and given again', async () => {
      const email = 'kakao@example.com';
      const loginCookie = async (): Promise<string> => {
        await suite().db('customers').where({ email }).update({ email_verified_at: new Date() });
        const res = await request(app).post('/api/customers/login').send({ email, password: SIGNUP.password });
        return cookieOf(res);
      };

      await request(app).post('/api/customers/signup').send({ ...SIGNUP, kakao_notify: true });
      expect((await suite().db('customers').where({ email }).first()).kakao_notify_consent_at).not.toBeNull();
      const cookie = await loginCookie();
      expect((await request(app).get('/api/customers/me').set('Cookie', cookie)).body.customer.kakao_notify).toBe(true);

      const off = await request(app).post('/api/customers/me/kakao-notify').set('Cookie', cookie).send({ enabled: false });
      expect(off.body.customer.kakao_notify).toBe(false);
      expect((await suite().db('customers').where({ email }).first()).kakao_notify_consent_at).toBeNull();

      const on = await request(app).post('/api/customers/me/kakao-notify').set('Cookie', cookie).send({ enabled: true });
      expect(on.body.customer.kakao_notify).toBe(true);

      expect((await request(app).post('/api/customers/me/kakao-notify').set('Cookie', cookie).send({ enabled: 'yes' })).status).toBe(400);
      expect((await request(app).post('/api/customers/me/kakao-notify').send({ enabled: true })).status).toBe(401);
    });

    it('is off after a sign-up without the box', async () => {
      await request(app).post('/api/customers/signup').send({ ...SIGNUP, email: 'plain@example.com' });

      expect((await suite().db('customers').where({ email: 'plain@example.com' }).first()).kakao_notify_consent_at).toBeNull();
    });
  });
});
