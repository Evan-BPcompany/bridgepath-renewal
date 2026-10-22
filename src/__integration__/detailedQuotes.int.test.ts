jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerMailer', () => ({
  ...jest.requireActual('../services/customerMailer'),
  sendCodeEmail: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
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
  customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.',
  contact_name: '김담당',
  contact_email: 'staff@bridgepath.co.kr',
  contact_phone: '010-1234-5678'
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
  const emailsOfKind = (kind: string) => suite().db('email_events').where({ email_type: kind });
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

  afterEach(() => {
    jest.restoreAllMocks();
    config.adminNotificationEmail = undefined;
  });

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
        customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.',
        contact: { name: '김담당', email: 'staff@bridgepath.co.kr', phone: '010-1234-5678' }
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
      await adminSave(id, { items: [ITEMS[0]], contact_name: '김담당', contact_email: 'staff@bridgepath.co.kr', contact_phone: '010-1234-5678' });
      await adminPublish(id, 1);

      expect((await mine(cookie, receipt)).body.quote).toMatchObject({
        total_amount: 6000000, fx_currency: null, fx_rate: null, valid_until: null, expired: false, lead_time: null, customer_note: null
      });
    });
  });

  describe('the e-mail that tells the customer', () => {
    const emails = () => suite().db('email_events').where({ email_type: 'quotation' }).orderBy('created_at');

    it('is queued in the same transaction as the publication, to the e-mail of the account, without any amount', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      expect(await emails()).toHaveLength(0);

      const published = await adminPublish(id, 1);

      expect(published.body.data.notification_queued).toBe(true);
      const rows = await emails();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        recipient_email: 'buyer@example.com', email_type: 'quotation', status: 'pending', estimate_id: id
      });
      expect(rows[0].subject).toBe(`[Bridge Path] 담당자 상세견적이 도착했어요 (접수번호 ${receipt})`);
      expect(rows[0].body).toContain(`/my-quotes.html?r=${receipt}`);
      expect(`${rows[0].subject} ${rows[0].body}`).not.toMatch(/6,400,000|6400000|12000|아세테이트|샘플/);
      expect(rows[0].idempotency_key).toMatch(/^quote-published-[0-9a-f-]{36}-v1$/);
    });

    it('goes to the account, not to whatever e-mail was typed on the request', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      await suite().db('estimates').where({ receipt_id: receipt }).update({ customer_email: 'typed-elsewhere@example.com' });
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);

      await adminPublish(id, 1);

      expect((await emails()).map(row => row.recipient_email)).toEqual(['buyer@example.com']);
    });

    it('says "changed" for the next publication, and makes one mail for each', async () => {
      const cookie = await customer('buyer@example.com');
      const id = await estimateId(await sendRequest(cookie));
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);
      await adminSave(id, { ...QUOTE, lead_time: '주문 후 약 8주', expected_edit_seq: 1 });

      await adminPublish(id, 2);

      const rows = await emails();
      expect(rows).toHaveLength(2);
      expect(rows[1].subject).toContain('수정되었어요');
      expect(rows[1].idempotency_key).toMatch(/-v2$/);
    });

    it('is not made for a publication that is refused, and not twice for two parallel ones', async () => {
      const cookie = await customer('buyer@example.com');
      const id = await estimateId(await sendRequest(cookie));
      await adminSave(id, QUOTE);
      await adminSave(id, { ...QUOTE, lead_time: 'x', expected_edit_seq: 1 });

      expect((await adminPublish(id, 1)).status).toBe(409);
      expect(await emails()).toHaveLength(0);

      await Promise.all([adminPublish(id, 2), adminPublish(id, 2)]);
      expect(await emails()).toHaveLength(1);
    });

    it('is not made when the mail cannot be queued: the publication is undone with it', async () => {
      const cookie = await customer('buyer@example.com');
      const id = await estimateId(await sendRequest(cookie));
      await adminSave(id, QUOTE);
      // Queuing fails inside the transaction (a rule that refuses every row of the outbox, for this test only).
      await suite().db.raw('ALTER TABLE email_events ADD CONSTRAINT never_ok CHECK (false) NOT VALID');
      try {
        const res = await adminPublish(id, 1);

        expect(res.status).toBe(500);
      } finally {
        await suite().db.raw('ALTER TABLE email_events DROP CONSTRAINT never_ok');
      }

      expect(await suite().db('detailed_quote_revisions').count({ n: '*' }).first()).toMatchObject({ n: '0' });
      expect((await suite().db('detailed_quotes').first()).version).toBe(0);
    });

    it('is not made, and the publication still works, when the request has no active account any more', async () => {
      const cookie = await customer('buyer@example.com');
      const id = await estimateId(await sendRequest(cookie));
      await adminSave(id, QUOTE);
      await suite().db('customers').update({ is_active: false });

      const res = await adminPublish(id, 1);

      expect(res.status).toBe(200);
      expect(res.body.data.notification_queued).toBe(false);
      expect(await emails()).toHaveLength(0);
    });
  });

  describe('the contact of the staff member', () => {
    it('is needed to publish: a quote without it is saved as a draft, and refused as a publication', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));
      await adminSave(id, { ...QUOTE, contact_name: undefined, contact_email: undefined, contact_phone: undefined });

      const refused = await adminPublish(id, 1);

      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('QUOTE_INCOMPLETE');
      expect(await suite().db('detailed_quote_revisions').count({ n: '*' }).first()).toMatchObject({ n: '0' });
      expect(await emailsOfKind('quotation')).toHaveLength(0);
    });

    it('is kept in the working copy, in each publication, and shown to the customer with the quote', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      const saved = await adminSave(id, QUOTE);
      expect(saved.body.data).toMatchObject({ contact_name: '김담당', contact_email: 'staff@bridgepath.co.kr', contact_phone: '010-1234-5678' });
      await adminPublish(id, 1);

      // A later change of the contact is not shown until it is published.
      await adminSave(id, { ...QUOTE, contact_name: '박담당', contact_phone: '02-123-4567', expected_edit_seq: 1 });
      expect((await mine(cookie, receipt)).body.quote.contact).toEqual({ name: '김담당', email: 'staff@bridgepath.co.kr', phone: '010-1234-5678' });

      await adminPublish(id, 2);
      expect((await mine(cookie, receipt)).body.quote.contact).toEqual({ name: '박담당', email: 'staff@bridgepath.co.kr', phone: '02-123-4567' });
      const snapshots = await suite().db('detailed_quote_revisions').orderBy('version');
      expect(snapshots.map(row => row.snapshot.contact_name)).toEqual(['김담당', '박담당']);
    });

    it('keeps the e-mail in lowercase and refuses an address or a number that is not one', async () => {
      const id = await estimateId(await sendRequest(await customer('buyer@example.com')));

      expect((await adminSave(id, { ...QUOTE, contact_email: 'Staff@Bridgepath.CO.KR' })).body.data.contact_email).toBe('staff@bridgepath.co.kr');
      expect((await adminSave(id, { ...QUOTE, contact_email: 'nope', expected_edit_seq: 1 })).status).toBe(400);
      expect((await adminSave(id, { ...QUOTE, contact_phone: 'call me', expected_edit_seq: 1 })).status).toBe(400);
    });

    it('starts the next quote of the same staff member from the name and phone of the last one, and their own e-mail', async () => {
      const first = await estimateId(await sendRequest(await customer('buyer@example.com')));
      const second = await estimateId(await sendRequest(await customer('other@example.com')));
      expect((await adminGet(first)).body.data.contact_defaults).toEqual({ name: 'master', email: expect.any(String), phone: null });

      await adminSave(first, { ...QUOTE, contact_name: '김담당', contact_phone: '010-1234-5678' });

      expect((await adminGet(second)).body.data.contact_defaults).toMatchObject({ name: '김담당', phone: '010-1234-5678' });
    });
  });

  describe('questions and consultation requests about a published quote', () => {
    const inquiriesUrl = (id: string): string => `/admin/estimates/${id}/inquiries`;
    const ask = (cookie: string | undefined, receipt: string, body: Record<string, unknown>) => {
      const req = request(app).post(`/api/customers/me/estimates/${receipt}/inquiries`);
      return (cookie ? req.set('Cookie', cookie) : req).send(body);
    };
    const adminInquiries = (id: string) => request(app).get(inquiriesUrl(id)).set('Cookie', adminCookie);
    const answer = (id: string, inquiryId: string, text: unknown) =>
      request(app).post(`${inquiriesUrl(id)}/${inquiryId}/answer`).set('Cookie', adminCookie).send({ answer: text });
    const done = (id: string, inquiryId: string, note?: string) =>
      request(app).post(`${inquiriesUrl(id)}/${inquiryId}/done`).set('Cookie', adminCookie).send(note ? { note } : {});
    const rows = () => suite().db('quote_inquiries').orderBy('created_at');

    // A request of a signed-in customer with a published quote.
    const published = async (email = 'buyer@example.com') => {
      const cookie = await customer(email);
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);
      await adminPublish(id, 1);
      return { cookie, receipt, id };
    };

    it('takes a question for the published quote, tells the staff without a word of it, and shows it to the staff', async () => {
      config.adminNotificationEmail = 'ops@example.com';
      const { cookie, receipt, id } = await published();

      const res = await ask(cookie, receipt, { kind: 'question', body: '  납기를 2주 줄일 수 있나요?  ' });

      expect(res.status).toBe(201);
      expect(res.body.inquiry).toMatchObject({ kind: 'question', quote_version: 1, body: '납기를 2주 줄일 수 있나요?', status: 'open', answer: null });
      expect(JSON.stringify(res.body)).not.toMatch(/handled_by|customer_id/);

      const mails = await suite().db('email_events').where({ recipient_email: 'ops@example.com' });
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ email_type: 'admin_notification', status: 'pending', estimate_id: id });
      expect(mails[0].subject).toBe(`[Bridge Path] 새 질문: ${receipt}`);
      expect(`${mails[0].subject} ${mails[0].body}`).not.toContain('납기');

      const list = (await adminInquiries(id)).body.data;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ kind: 'question', body: '납기를 2주 줄일 수 있나요?', status: 'open', handled_by: null });
    });

    it('takes it only for a published quote, a request of the customer, and a signed-in customer', async () => {
      const cookie = await customer('buyer@example.com');
      const receipt = await sendRequest(cookie);
      const id = await estimateId(receipt);
      await adminSave(id, QUOTE);

      const draft = await ask(cookie, receipt, { kind: 'question', body: '질문' });
      expect(draft.status).toBe(409);
      expect(draft.body.code).toBe('NO_QUOTE');

      await adminPublish(id, 1);
      const other = await customer('other@example.com');
      expect((await ask(other, receipt, { kind: 'question', body: '질문' })).status).toBe(404);
      expect((await ask(undefined, receipt, { kind: 'question', body: '질문' })).status).toBe(401);
      expect((await ask(cookie, 'BP20990101999', { kind: 'question', body: '질문' })).status).toBe(404);
      expect(await rows()).toHaveLength(0);
    });

    it('refuses a question over 300 characters, and the database refuses it too', async () => {
      const { cookie, receipt, id } = await published();

      const res = await ask(cookie, receipt, { kind: 'question', body: '가'.repeat(301) });
      expect(res.status).toBe(400);
      expect((await ask(cookie, receipt, { kind: 'question', body: '가'.repeat(300) })).status).toBe(201);

      await expect(
        suite().db('quote_inquiries').insert({ estimate_id: id, quote_version: 1, kind: 'consultation', phone: '010-1234-5678', body: '가'.repeat(301) })
      ).rejects.toThrow();
    });

    it('keeps one open question at a time: the second is refused until the first is answered', async () => {
      const { cookie, receipt, id } = await published();
      const first = await ask(cookie, receipt, { kind: 'question', body: '첫 질문' });

      const second = await ask(cookie, receipt, { kind: 'question', body: '둘째 질문' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ALREADY_OPEN');

      await answer(id, first.body.inquiry.id, '답변');
      expect((await ask(cookie, receipt, { kind: 'question', body: '둘째 질문' })).status).toBe(201);
      expect(await rows()).toHaveLength(2);
    });

    it('lets only one of two parallel questions in', async () => {
      const { cookie, receipt } = await published();

      const results = await Promise.all([ask(cookie, receipt, { kind: 'question', body: 'a' }), ask(cookie, receipt, { kind: 'question', body: 'b' })]);

      expect(results.map(res => res.status).sort()).toEqual([201, 409]);
      expect(await rows()).toHaveLength(1);
    });

    it('stops at 20 on a request', async () => {
      const { cookie, receipt, id } = await published();
      for (let i = 0; i < 20; i += 1) {
        await suite().db('quote_inquiries').insert({
          estimate_id: id, quote_version: 1, kind: 'question', body: `q${i}`, status: 'answered', answer: 'a', handled_at: new Date()
        });
      }

      const res = await ask(cookie, receipt, { kind: 'question', body: '21번째' });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('TOO_MANY');
    });

    describe('the answer', () => {
      it('is written by the staff, shown to the customer, and told to them by e-mail without the answer in it', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'question', body: '납기를 줄일 수 있나요?' });

        const res = await answer(id, asked.body.inquiry.id, '  가능합니다. 수량 500개 이상이면요.  ');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'answered', answer: '가능합니다. 수량 500개 이상이면요.', handled_by: { username: 'master' } });
        const seen = (await mine(cookie, receipt)).body.inquiries;
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ kind: 'question', status: 'answered', answer: '가능합니다. 수량 500개 이상이면요.' });
        expect(JSON.stringify(seen)).not.toMatch(/handled_by|master/);

        const mails = await suite().db('email_events').where({ email_type: 'status_update' });
        expect(mails).toHaveLength(1);
        expect(mails[0]).toMatchObject({ recipient_email: 'buyer@example.com', status: 'pending' });
        expect(mails[0].subject).toBe(`[Bridge Path] 남기신 질문에 답변이 달렸어요 (접수번호 ${receipt})`);
        expect(`${mails[0].subject} ${mails[0].body}`).not.toContain('수량 500개');
        expect(mails[0].body).toContain(`/my-quotes.html?r=${receipt}`);
      });

      it('is given once: the second answer is refused, and the first stays', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'question', body: '질문' });
        await answer(id, asked.body.inquiry.id, '첫 답변');

        const second = await answer(id, asked.body.inquiry.id, '둘째 답변');

        expect(second.status).toBe(409);
        expect(second.body.code).toBe('ALREADY_HANDLED');
        expect((await rows())[0].answer).toBe('첫 답변');
        expect(await suite().db('email_events').where({ email_type: 'status_update' }).count({ n: '*' }).first()).toMatchObject({ n: '1' });
      });

      it('lets only one of two parallel answers in, and sends one mail', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'question', body: '질문' });

        const results = await Promise.all([answer(id, asked.body.inquiry.id, 'a'), answer(id, asked.body.inquiry.id, 'b')]);

        expect(results.map(res => res.status).sort()).toEqual([200, 409]);
        expect(await suite().db('email_events').where({ email_type: 'status_update' }).count({ n: '*' }).first()).toMatchObject({ n: '1' });
      });

      it('is refused for an inquiry of another request, one that does not exist, and a consultation', async () => {
        const mineOne = await published();
        const theirs = await published('other@example.com');
        const asked = await ask(mineOne.cookie, mineOne.receipt, { kind: 'question', body: '질문' });
        const consult = await ask(theirs.cookie, theirs.receipt, { kind: 'consultation', phone: '010-1234-5678' });

        expect((await answer(theirs.id, asked.body.inquiry.id, '답변')).body.code).toBe('INQUIRY_NOT_FOUND');
        expect((await answer(mineOne.id, '00000000-0000-4000-8000-000000000000', '답변')).status).toBe(404);
        expect((await answer(theirs.id, consult.body.inquiry.id, '답변')).body.code).toBe('WRONG_KIND');
        expect((await rows()).every(row => row.status === 'open')).toBe(true);
      });

      it('needs an answer of up to 500 characters, and is for staff only', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'question', body: '질문' });

        expect((await answer(id, asked.body.inquiry.id, '')).status).toBe(400);
        expect((await answer(id, asked.body.inquiry.id, '가'.repeat(501))).status).toBe(400);
        expect((await request(app).post(`${inquiriesUrl(id)}/${asked.body.inquiry.id}/answer`).set('Cookie', cookie).send({ answer: 'x' })).status).toBe(401);
        expect((await rows())[0].status).toBe('open');
      });

      it('is not mailed when the customer is gone, and still recorded', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'question', body: '질문' });
        await suite().db('customers').update({ is_active: false });

        const res = await answer(id, asked.body.inquiry.id, '답변');

        expect(res.status).toBe(200);
        expect(await suite().db('email_events').where({ email_type: 'status_update' }).count({ n: '*' }).first()).toMatchObject({ n: '0' });
      });
    });

    describe('a request for a consultation', () => {
      it('is taken with the phone to call, the time and a note, and the staff see all of it', async () => {
        config.adminNotificationEmail = 'ops@example.com';
        const { cookie, receipt, id } = await published();

        const res = await ask(cookie, receipt, { kind: 'consultation', phone: ' 010-9999-8888 ', preferred_time: 'weekday_pm', body: '납기 이야기' });

        expect(res.status).toBe(201);
        expect(res.body.inquiry).toMatchObject({ kind: 'consultation', phone: '010-9999-8888', preferred_time: 'weekday_pm', body: '납기 이야기', status: 'open' });
        const mail = (await suite().db('email_events').where({ recipient_email: 'ops@example.com' }))[0];
        expect(mail.subject).toBe(`[Bridge Path] 새 심층상담 요청: ${receipt}`);
        expect(`${mail.subject} ${mail.body}`).not.toMatch(/010-9999|납기 이야기/);

        const seen = (await adminInquiries(id)).body.data[0];
        expect(seen).toMatchObject({ kind: 'consultation', phone: '010-9999-8888', preferred_time: 'weekday_pm', status: 'open' });
      });

      it('needs a phone, and keeps one open consultation next to one open question', async () => {
        const { cookie, receipt } = await published();

        expect((await ask(cookie, receipt, { kind: 'consultation' })).status).toBe(400);
        expect((await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' })).status).toBe(201);
        expect((await ask(cookie, receipt, { kind: 'question', body: '질문' })).status).toBe(201);
        const again = await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' });
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('ALREADY_OPEN');
      });

      it('is closed by the staff after the call, with a note the customer can read, and can be asked for again', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' });

        const res = await done(id, asked.body.inquiry.id, '통화함. 샘플을 보내기로 함');

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'done', answer: '통화함. 샘플을 보내기로 함', handled_by: { username: 'master' } });
        const seen = (await mine(cookie, receipt)).body.inquiries;
        expect(seen[0]).toMatchObject({ kind: 'consultation', status: 'done', answer: '통화함. 샘플을 보내기로 함' });
        expect(await suite().db('email_events').where({ email_type: 'status_update' }).count({ n: '*' }).first()).toMatchObject({ n: '0' });
        expect((await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' })).status).toBe(201);
      });

      it('is closed without a note too, once, and not as a question', async () => {
        const { cookie, receipt, id } = await published();
        const asked = await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' });
        const question = await ask(cookie, receipt, { kind: 'question', body: '질문' });

        expect((await done(id, question.body.inquiry.id)).body.code).toBe('WRONG_KIND');
        expect((await done(id, asked.body.inquiry.id)).status).toBe(200);
        expect((await done(id, asked.body.inquiry.id)).body.code).toBe('ALREADY_HANDLED');
        expect((await rows()).find(row => row.id === asked.body.inquiry.id).answer).toBeNull();
      });
    });

    describe('what the staff see in the list of requests', () => {
      it('counts what is waiting, and no longer once it is handled', async () => {
        const { cookie, receipt, id } = await published();
        await ask(cookie, receipt, { kind: 'question', body: '질문' });
        const consult = await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' });
        const openOf = async () => {
          const list = await request(app).get('/admin/estimates').set('Cookie', adminCookie);
          return list.body.data.find((item: { id: string }) => item.id === id).open_inquiries;
        };

        expect(await openOf()).toBe(2);
        await done(id, consult.body.inquiry.id);
        expect(await openOf()).toBe(1);
      });

      it('lists the waiting ones first, the longest waiting on top, then the handled ones', async () => {
        const { cookie, receipt, id } = await published();
        const first = await ask(cookie, receipt, { kind: 'question', body: '첫 질문' });
        await ask(cookie, receipt, { kind: 'consultation', phone: '010-1234-5678' });
        await answer(id, first.body.inquiry.id, '답변');
        await ask(cookie, receipt, { kind: 'question', body: '셋째 질문' });

        const list = (await adminInquiries(id)).body.data;

        expect(list.map((item: { status: string; kind: string }) => `${item.status}:${item.kind}`)).toEqual([
          'open:consultation', 'open:question', 'answered:question'
        ]);
      });
    });

    it('keeps the inquiries when the account goes, without the link to it', async () => {
      const { cookie, receipt, id } = await published();
      await ask(cookie, receipt, { kind: 'question', body: '질문' });

      await suite().db('customers').del();

      expect((await rows())[0]).toMatchObject({ customer_id: null, body: '질문' });
      expect((await adminInquiries(id)).body.data).toHaveLength(1);
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
