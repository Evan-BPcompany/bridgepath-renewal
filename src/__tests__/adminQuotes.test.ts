jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/adminQuoteService', () => ({
  ...jest.requireActual('../services/adminQuoteService'),
  getQuoteContext: jest.fn(),
  saveQuote: jest.fn(),
  publishQuote: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import * as service from '../services/adminQuoteService';
import { QuoteError } from '../services/adminQuoteService';
import { ADMIN_ID, MANAGER_ID, ESTIMATE_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

const URL = `/admin/estimates/${ESTIMATE_ID}/quote`;
const mocked = (fn: unknown) => fn as jest.Mock;
const BODY = {
  items: [{ name: '아세테이트 프레임', quantity: 500, unit_price: 12000 }],
  lead_time: '주문 후 약 6주',
  customer_note: '샘플 확인 후 확정'
};
const QUOTE = {
  id: 'q1', items: [{ name: '아세테이트 프레임', quantity: 500, unit_price: 12000, amount: 6000000 }], total_amount: 6000000, currency: 'KRW',
  fx_currency: null, fx_rate: null, valid_until: null, lead_time: null, customer_note: null, version: 0, edit_seq: 1,
  has_unpublished_changes: true, created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z', published_at: null, updated_by: null
};

describe('Admin detailed quote API (mocked service)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const audit = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  beforeEach(() => {
    jest.resetAllMocks();
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    mocked(service.saveQuote).mockResolvedValue(QUOTE);
    mocked(service.publishQuote).mockResolvedValue({ quote: { ...QUOTE, version: 1, has_unpublished_changes: false }, notification_queued: true });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('who may use it', () => {
    it.each([
      ['get', (r: request.Test) => r],
      ['put', (r: request.Test) => r.send(BODY)],
      ['publish', (r: request.Test) => r.send({ expected_edit_seq: 1 })]
    ])('refuses %s without a login', async (kind, fill) => {
      const base = kind === 'get' ? request(app).get(URL) : kind === 'put' ? request(app).put(URL) : request(app).post(`${URL}/publish`);

      const res = await fill(base);

      expect(res.status).toBe(401);
      expect(service.getQuoteContext).not.toHaveBeenCalled();
      expect(service.saveQuote).not.toHaveBeenCalled();
      expect(service.publishQuote).not.toHaveBeenCalled();
    });

    it('is open to a manager as to an admin, and the author is the one in the session', async () => {
      await request(app).put(URL).set('Cookie', authCookie('manager')).send({ ...BODY, updated_by: 'someone-else' });
      await request(app).put(URL).set('Cookie', authCookie('admin')).send(BODY);

      expect(mocked(service.saveQuote).mock.calls.map(call => call[1])).toEqual([MANAGER_ID, ADMIN_ID]);
      expect(JSON.stringify(mocked(service.saveQuote).mock.calls[0][2])).not.toContain('someone-else');
    });

    it('wants JSON for a change', async () => {
      const put = await request(app).put(URL).set('Cookie', authCookie('admin')).type('form').send('items=1');
      const publish = await request(app).post(`${URL}/publish`).set('Cookie', authCookie('admin')).type('form').send('x=1');

      expect(put.status).toBe(415);
      expect(publish.status).toBe(415);
      expect(service.saveQuote).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('gives the working copy, the revisions and whether the request has an account', async () => {
      const context = { estimate_id: ESTIMATE_ID, has_account: true, quote: QUOTE, revisions: [] };
      mocked(service.getQuoteContext).mockResolvedValue(context);

      const res = await request(app).get(URL).set('Cookie', authCookie('manager'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: { ...context, contact_defaults: { name: 'staff', email: 'staff@bridgepath.local', phone: null } }
      });
    });

    it('is 404 for an estimate that does not exist and 400 for an id that is not a UUID', async () => {
      mocked(service.getQuoteContext).mockResolvedValue(null);

      expect((await request(app).get(URL).set('Cookie', authCookie('admin'))).status).toBe(404);
      const bad = await request(app).get('/admin/estimates/not-a-uuid/quote').set('Cookie', authCookie('admin'));
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('INVALID_ID');
    });
  });

  describe('PUT (save the working copy)', () => {
    it('saves what is valid, and audits it without the contents', async () => {
      const res = await request(app).put(URL).set('Cookie', authCookie('admin')).send({ ...BODY, expected_edit_seq: 4 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(QUOTE);
      const [estimateId, adminId, input] = mocked(service.saveQuote).mock.calls[0];
      expect(estimateId).toBe(ESTIMATE_ID);
      expect(adminId).toBe(ADMIN_ID);
      expect(input).toMatchObject({ items: BODY.items, lead_time: '주문 후 약 6주', expected_edit_seq: 4 });

      const entry = audit().find(item => item.action === 'quote.save')!;
      expect(entry).toMatchObject({ result: 'success', http_status: 200, admin_id: ADMIN_ID, estimate_id: ESTIMATE_ID, quote_id: 'q1' });
      expect(JSON.stringify(entry)).not.toContain('샘플');
      expect(JSON.stringify(entry)).not.toContain('아세테이트');
    });

    it('refuses an invalid quote with the fields, and saves nothing', async () => {
      const res = await request(app)
        .put(URL)
        .set('Cookie', authCookie('admin'))
        .send({ items: [{ name: '', quantity: 0, unit_price: -1 }] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['items[0].name', 'items[0].quantity', 'items[0].unit_price']);
      expect(service.saveQuote).not.toHaveBeenCalled();
    });

    it.each([
      ['ESTIMATE_NOT_FOUND', 404],
      ['NO_CUSTOMER_ACCOUNT', 409],
      ['QUOTE_CONFLICT', 409]
    ] as const)('answers %s with %i and audits the refusal', async (code, status) => {
      mocked(service.saveQuote).mockRejectedValue(new QuoteError(code));

      const res = await request(app).put(URL).set('Cookie', authCookie('admin')).send(BODY);

      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(audit().find(item => item.action === 'quote.save')).toMatchObject({ result: 'denied', error_code: code, http_status: status });
    });

    it('answers 500 without the text of the error', async () => {
      mocked(service.saveQuote).mockRejectedValue(new Error('connection to 10.0.0.5 refused'));

      const res = await request(app).put(URL).set('Cookie', authCookie('admin')).send(BODY);

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    });
  });

  describe('POST /publish', () => {
    it('publishes the save that was on the screen, and audits the version', async () => {
      const res = await request(app).post(`${URL}/publish`).set('Cookie', authCookie('manager')).send({ expected_edit_seq: 3 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ version: 1, has_unpublished_changes: false, notification_queued: true });
      expect(service.publishQuote).toHaveBeenCalledWith(ESTIMATE_ID, MANAGER_ID, 3);
      expect(audit().find(item => item.action === 'quote.publish')).toMatchObject({
        result: 'success', admin_id: MANAGER_ID, estimate_id: ESTIMATE_ID, quote_version: 1
      });
    });

    it.each([{}, { expected_edit_seq: 0 }, { expected_edit_seq: '3' }, { expected_edit_seq: 1.5 }])('needs the save it publishes (%j)', async body => {
      const res = await request(app).post(`${URL}/publish`).set('Cookie', authCookie('admin')).send(body);

      expect(res.status).toBe(400);
      expect(service.publishQuote).not.toHaveBeenCalled();
    });

    it.each([
      ['NO_QUOTE', 404],
      ['QUOTE_CONFLICT', 409],
      ['QUOTE_INCOMPLETE', 400],
      ['NOTHING_TO_PUBLISH', 409]
    ] as const)('answers %s with %i', async (code, status) => {
      mocked(service.publishQuote).mockRejectedValue(new QuoteError(code));

      const res = await request(app).post(`${URL}/publish`).set('Cookie', authCookie('admin')).send({ expected_edit_seq: 1 });

      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
    });
  });
});
