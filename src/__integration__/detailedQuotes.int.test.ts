jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerMailer', () => ({
  ...jest.requireActual('../services/customerMailer'),
  sendCodeEmail: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { sendCodeEmail } from '../services/customerMailer';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { CUSTOMER_PROFILE, SHOE_SPEC, cookieValueOf, createTestApp, resetData } from './helpers/fixtures';

const PASSWORD = 'abcdefg1';
const ITEMS = [
  { name: '아세테이트 프레임', quantity: 500, unit_price: 12000 },
  { name: '케이스·클리너', quantity: 500, unit_price: 800 }
];
const QUOTE = {
  items: ITEMS,
  fx_currency: 'USD',
  fx_rate: 1330.79,
  valid_until: '2099-12-31',
  lead_time: '주문 후 약 6주',
  customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.'
};

// The detailed quote end to end on a real PostgreSQL: the staff write and publish it, the customer
// reads it on "내 견적". The mail is replaced; the codes are read from the replaced mailer.
describeIntegration('detailed quotes on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let adminCookie: string;

  const mailed = sendCodeEmail as unknown as jest.Mock;
  const codeOf = (email: string): string => {
    const calls = mailed.mock.calls.filter(call => call[0] === email && call[1] === 'signup');
    return calls[calls.length - 1][2];
  };

  // A signed-in customer: signs up, verifies the e-mail, returns the cookie.
  const customer = async (email: string): Promise<string> => {
    await request(app).post('/api/customers/signup').send({
      email, password: PASSWORD, name: 'Kim', phone: '010-1234-5678', privacy_consent: true, privacy_consent_version: 'dev-draft'
    });
    const res = await request(app).post('/api/customers/verify-email').send({ email, code: codeOf(email) });
    return `bp_session=${cookieValueOf(res, 'bp_session')}`;
  };

  const sendRequest = async (cookie: string | undefined, kind: 'detailed' | 'simple' = 'detailed'): Promise<string> => {
    const req = request(app).post('/api/estimates');
    const res = await (cookie ? req.set('Cookie', cookie) : req).send({
      ...CUSTOMER_PROFILE,
      customer_email: 'buyer@example.com',
      category: 'shoes',
      specification_json: SHOE_SPEC,
      request_kind: kind
    });
    expect(res.status).toBe(201);
    return res.body.receipt_id as string;
  };

  const estimateId = async (receiptId: string): Promise<string> =>
    (await suite().db('estimates').where({ receipt_id: receiptId }).first()).id;
  const quoteUrl = (id: string): string => `/admin/estimates/${id}/quote`;
  const adminGet = (id: string) => request(app).get(quoteUrl(id)).set('Cookie', adminCookie);
  const adminSave = (id: string, body: Record<string, unknown>) => request(app).put(quoteUrl(id)).set('Cookie', adminCookie).send(body);
  const adminPublish = (id: string, seq: number) =>
    request(app).post(`${quoteUrl(id)}/publish`).set('Cookie', adminCookie).send({ expected_edit_seq: seq });
  const mine = (cookie: string, receiptId: string) => request(app).get(`/api/customers/me/estimates/${receiptId}`).set('Cookie', cookie);

  beforeEach(async () => {
    await resetData(suite().db);
    app = createTestApp();
    mailed.mockReset().mockResolvedValue(undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const login = await request(app).post('/admin/login').send({ username: 'master', password: 'Correct-Horse-9' });
    adminCookie = `access_token=${cookieValueOf(login, 'access_token')}`;
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the working copy (staff only)', () => {
    it('is empty at first, and says whether the request has an account', async () => {
      const cookie = await customer('buyer@example.com');
      const withAccount = await estimateId(await sendRequest(cookie));
      const guest = await estimateId(await sendRequest(undefined, 'simple'));

      const a = await adminGet(withAccount);
      const g = await adminGet(guest);

      expect(a.body.data).toMatchObject({ has_account: true, quote: null, revisions: [] });
      expect(g.body.data).toMatchObject({ has_account: false, quote: null });
    });

    it('saves with the amounts and the total counted by the server, whatever the client says', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));

      const res = await adminSave(id, {
        ...QUOTE,
        items: [{ ...ITEMS[0], amount: 1 }, ITEMS[1]],
        total_amount: 5,
        total: 5,
        version: 99,
        updated_by: 'someone-else'
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        items: [
          { name: '아세테이트 프레임', quantity: 500, unit_price: 12000, amount: 6000000 },
          { name: '케이스·클리너', quantity: 500, unit_price: 800, amount: 400000 }
        ],
        total_amount: 6400000,
        currency: 'KRW',
        fx_currency: 'USD',
        fx_rate: 1330.79,
        valid_until: '2099-12-31',
        lead_time: '주문 후 약 6주',
        version: 0,
        edit_seq: 1,
        has_unpublished_changes: true,
        published_at: null,
        updated_by: { username: 'master' }
      });
      const row = await suite().db('detailed_quotes').where({ estimate_id: id }).first();
      expect(Number(row.total_amount)).toBe(6400000);
      expect(row.version).toBe(0);
    });

    it('refuses a quote for a request that was sent without an account', async () => {
      const id = await estimateId(await sendRequest(undefined, 'simple'));

      const res = await adminSave(id, QUOTE);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NO_CUSTOMER_ACCOUNT');
      expect(await suite().db('detailed_quotes').count({ n: '*' }).first()).toMatchObject({ n: '0' });
    });

    it('is 404 for an estimate that does not exist', async () => {
      const res = await adminSave('00000000-0000-4000-8000-000000000000', QUOTE);
      expect(res.status).toBe(404);
    });

    it('notices a save made from an old copy, and a first save that comes second', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, QUOTE);

      const again = await adminSave(id, { ...QUOTE, lead_time: '다른 값' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('QUOTE_CONFLICT');

      const second = await adminSave(id, { ...QUOTE, lead_time: '주문 후 약 8주', expected_edit_seq: 1 });
      expect(second.status).toBe(200);
      expect(second.body.data).toMatchObject({ edit_seq: 2, lead_time: '주문 후 약 8주' });

      const stale = await adminSave(id, { ...QUOTE, expected_edit_seq: 1 });
      expect(stale.status).toBe(409);
      expect((await adminGet(id)).body.data.quote.lead_time).toBe('주문 후 약 8주');
    });

    it('lets only one of two parallel first saves win', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));

      const results = await Promise.all([adminSave(id, QUOTE), adminSave(id, { ...QUOTE, lead_time: 'other' })]);

      expect(results.map(res => res.status).sort()).toEqual([200, 409]);
      expect(await suite().db('detailed_quotes').count({ n: '*' }).first()).toMatchObject({ n: '1' });
    });

    it('refuses what is not valid and keeps the copy as it was', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, QUOTE);

      const bad = await adminSave(id, { items: [{ name: '', quantity: 0, unit_price: -1 }], expected_edit_seq: 1 });

      expect(bad.status).toBe(400);
      expect((await adminGet(id)).body.data.quote).toMatchObject({ edit_seq: 1, total_amount: 6400000 });
    });

    it('is not for someone who is not staff: a customer session, or nothing', async () => {
      const cookie = await customer('buyer@example.com');
      const id = await estimateId(await sendRequest(cookie));

      expect((await request(app).get(quoteUrl(id)).set('Cookie', cookie)).status).toBe(401);
      expect((await request(app).put(quoteUrl(id)).send(QUOTE)).status).toBe(401);
    });
  });

  describe('publishing, and what the customer sees', () => {
    it('shows nothing until it is published, then the quote as published', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);

      const before = await mine(cookie, receipt);
      expect(before.status).toBe(200);
      expect(before.body.quote).toBeNull();
      expect((await request(app).get('/api/customers/me/estimates').set('Cookie', cookie)).body.estimates[0].has_quote).toBe(false);

      const published = await adminPublish(id, 1);
      expect(published.status).toBe(200);
      expect(published.body.data).toMatchObject({ version: 1, has_unpublished_changes: false });
      expect(published.body.data.published_at).toEqual(expect.any(String));

      const after = await mine(cookie, receipt);
      expect(after.body.quote).toEqual({
        version: 1,
        published_at: published.body.data.published_at,
        currency: 'KRW',
        items: [
          { name: '아세테이트 프레임', quantity: 500, unit_price: 12000, amount: 6000000 },
          { name: '케이스·클리너', quantity: 500, unit_price: 800, amount: 400000 }
        ],
        total_amount: 6400000,
        fx_currency: 'USD',
        fx_rate: 1330.79,
        valid_until: '2099-12-31',
        expired: false,
        lead_time: '주문 후 약 6주',
        customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.'
      });
      expect(after.body.estimate).toMatchObject({ receipt_id: receipt, category: 'shoes', request_kind: 'detailed', quantity: 500 });
      expect((await request(app).get('/api/customers/me/estimates').set('Cookie', cookie)).body.estimates[0].has_quote).toBe(true);
    });

    it('keeps showing the published version while the staff edit, and the new one only after it is published', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);

      const edited = await adminSave(id, { ...QUOTE, lead_time: '주문 후 약 8주', items: [{ ...ITEMS[0], unit_price: 11000 }], expected_edit_seq: 1 });
      expect(edited.body.data).toMatchObject({ version: 1, has_unpublished_changes: true, edit_seq: 2, total_amount: 5500000 });
      expect((await mine(cookie, receipt)).body.quote).toMatchObject({ version: 1, lead_time: '주문 후 약 6주', total_amount: 6400000 });

      const again = await adminPublish(id, 2);
      expect(again.body.data).toMatchObject({ version: 2, has_unpublished_changes: false });
      expect((await mine(cookie, receipt)).body.quote).toMatchObject({ version: 2, lead_time: '주문 후 약 8주', total_amount: 5500000 });

      const context = (await adminGet(id)).body.data;
      expect(context.revisions.map((r: { version: number }) => r.version)).toEqual([2, 1]);
      expect(context.revisions[0].published_by).toMatchObject({ username: 'master' });
      const snapshots = await suite().db('detailed_quote_revisions').orderBy('version');
      expect(snapshots.map(row => Number(row.snapshot.total_amount))).toEqual([6400000, 5500000]);
    });

    it('publishes only the save that was on the screen', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, QUOTE);
      await adminSave(id, { ...QUOTE, lead_time: '바뀜', expected_edit_seq: 1 });

      const stale = await adminPublish(id, 1);

      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('QUOTE_CONFLICT');
      expect(await suite().db('detailed_quote_revisions').count({ n: '*' }).first()).toMatchObject({ n: '0' });
    });

    it('has nothing to publish twice, and nothing to publish without a copy', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      expect((await adminPublish(id, 1)).body.code).toBe('NO_QUOTE');

      await adminSave(id, QUOTE);
      await adminPublish(id, 1);
      const twice = await adminPublish(id, 1);

      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('NOTHING_TO_PUBLISH');
      expect(await suite().db('detailed_quote_revisions').count({ n: '*' }).first()).toMatchObject({ n: '1' });
    });

    it('lets two parallel publications make one revision', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, QUOTE);

      const results = await Promise.all([adminPublish(id, 1), adminPublish(id, 1)]);

      expect(results.map(res => res.status).sort()).toEqual([200, 409]);
      expect(await suite().db('detailed_quote_revisions').count({ n: '*' }).first()).toMatchObject({ n: '1' });
    });

    it('does not publish a copy whose validity date has passed since it was saved', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, QUOTE);
      await suite().db('detailed_quotes').update({ valid_until: '2020-01-01' });

      const res = await adminPublish(id, 1);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('QUOTE_INCOMPLETE');
    });

    it('tells the customer when a published quote is past its validity date', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);
      await suite().db('detailed_quote_revisions').update({ snapshot: suite().db.raw(`jsonb_set(snapshot, '{valid_until}', '"2020-01-01"')`) });

      expect((await mine(cookie, receipt)).body.quote).toMatchObject({ valid_until: '2020-01-01', expired: true });
    });

    it('works without the optional parts', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, { items: [ITEMS[0]] });
      await adminPublish(id, 1);

      expect((await mine(cookie, receipt)).body.quote).toMatchObject({
        total_amount: 6000000, fx_currency: null, fx_rate: null, valid_until: null, expired: false, lead_time: null, customer_note: null
      });
    });
  });

  describe('who can read it', () => {
    it('is the customer who sent the request only: anyone else gets a plain 404', async () => {
      const owner = await customer('buyer@example.com');
      const other = await customer('other@example.com');
      const receipt = await sendRequest(owner);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);

      const stranger = await mine(other, receipt);
      const unknown = await mine(other, 'BP20990101999');

      expect(stranger.status).toBe(404);
      expect(stranger.body.code).toBe('ESTIMATE_NOT_FOUND');
      expect(unknown.status).toBe(404);
      expect(stranger.body).toEqual({ ...unknown.body, timestamp: stranger.body.timestamp });
      expect(JSON.stringify(stranger.body)).not.toContain('아세테이트');
      expect((await request(app).get('/api/customers/me/estimates').set('Cookie', other)).body.estimates).toEqual([]);
      expect((await request(app).get(`/api/customers/me/estimates/${receipt}`)).status).toBe(401);
    });

    it('lists the requests of the customer, newest first, with their kind', async () => {
      const cookie = await customer('buyer@example.com');
      const first = await sendRequest(cookie, 'simple');
      const second = await sendRequest(cookie, 'detailed');
      await sendRequest(undefined, 'simple');

      const list = (await request(app).get('/api/customers/me/estimates').set('Cookie', cookie)).body.estimates;

      expect(list.map((item: { receipt_id: string }) => item.receipt_id)).toEqual([second, first]);
      expect(list.map((item: { request_kind: string }) => item.request_kind)).toEqual(['detailed', 'simple']);
    });

    it('never shows the internal status, the memos or the staff to the customer', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      const memo = await request(app).post(`/admin/estimates/${id}/memos`).set('Cookie', adminCookie).send({ content: '내부 메모: 공장 원가 8,000원' });
      expect(memo.status).toBe(201);
      const status = await request(app).patch(`/admin/estimates/${id}/status`).set('Cookie', adminCookie).send({ to_status: 'under_review' });
      expect(status.status).toBe(200);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);

      const text = JSON.stringify([(await mine(cookie, receipt)).body, (await request(app).get('/api/customers/me/estimates').set('Cookie', cookie)).body]);

      expect(text).not.toMatch(/under_review|new_receipt|내부 메모|8,000|master|admin|edit_seq|has_unpublished|customer_id|specification/i);
    });

    it('keeps the quote when the account is deleted from the request, but nobody can read it then', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);

      await suite().db('customers').del();

      expect((await mine(cookie, receipt)).status).toBe(401);
      expect(await suite().db('detailed_quotes').count({ n: '*' }).first()).toMatchObject({ n: '1' });
      expect((await adminGet(id)).body.data.has_account).toBe(false);
    });
  });
});
