jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerAuthService', () => ({
  ...jest.requireActual('../services/customerAuthService'),
  findSessionCustomer: jest.fn()
}));
jest.mock('../services/customerQuoteService', () => ({
  listOwnEstimates: jest.fn(),
  getOwnEstimate: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { createApp } from '../app';
import { findSessionCustomer } from '../services/customerAuthService';
import { getOwnEstimate, listOwnEstimates } from '../services/customerQuoteService';

const mocked = (fn: unknown) => fn as jest.Mock;
const CUSTOMER_ID = 'c0000000-0000-0000-0000-0000000000c1';
const COOKIE = `bp_session=${'a'.repeat(64)}`;
const RECEIPT = 'BP20261021001';

const DETAIL = {
  estimate: { receipt_id: RECEIPT, category: 'eyewear', request_kind: 'detailed', created_at: '2026-10-21T00:00:00.000Z', quantity: 500 },
  quote: {
    version: 2, published_at: '2026-10-22T00:00:00.000Z', currency: 'KRW',
    items: [{ name: '아세테이트 프레임', quantity: 500, unit_price: 12000, amount: 6000000 }],
    total_amount: 6000000, fx_currency: 'USD', fx_rate: 1330.79, valid_until: '2026-11-20', expired: false,
    lead_time: '주문 후 약 6주', customer_note: '샘플 확인 후 확정'
  }
};

describe('GET /api/customers/me/estimates (mocked service)', () => {
  let app: Express;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    app = createApp({ rateLimits: { customerRead: { windowMs: 60_000, max: 100000 } } });
    mocked(findSessionCustomer).mockResolvedValue({
      customer: { id: CUSTOMER_ID, email: 'buyer@example.com', consent_required: false, phone_required: false },
      sessionId: 's1'
    });
    mocked(listOwnEstimates).mockResolvedValue([]);
    mocked(getOwnEstimate).mockResolvedValue(DETAIL);
  });

  afterEach(() => jest.restoreAllMocks());

  it('needs a signed-in customer, for the list and for one request', async () => {
    mocked(findSessionCustomer).mockResolvedValue(undefined);

    const list = await request(app).get('/api/customers/me/estimates');
    const one = await request(app).get(`/api/customers/me/estimates/${RECEIPT}`).set('Cookie', COOKIE);

    expect(list.status).toBe(401);
    expect(list.body.code).toBe('CUSTOMER_AUTH_REQUIRED');
    expect(one.status).toBe(401);
    expect(listOwnEstimates).not.toHaveBeenCalled();
    expect(getOwnEstimate).not.toHaveBeenCalled();
  });

  it('lists the requests of the customer in the session, never of anyone the query names', async () => {
    mocked(listOwnEstimates).mockResolvedValue([
      { receipt_id: RECEIPT, category: 'eyewear', request_kind: 'detailed', created_at: '2026-10-21T00:00:00.000Z', has_quote: true }
    ]);

    const res = await request(app).get('/api/customers/me/estimates?customer_id=c0000000-0000-0000-0000-0000000000ff').set('Cookie', COOKIE);

    expect(res.status).toBe(200);
    expect(res.body.estimates).toHaveLength(1);
    expect(listOwnEstimates).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it('gives one request with its published quote, and only the fields that are meant for the customer', async () => {
    const res = await request(app).get(`/api/customers/me/estimates/${RECEIPT}`).set('Cookie', COOKIE);

    expect(res.status).toBe(200);
    expect(getOwnEstimate).toHaveBeenCalledWith(CUSTOMER_ID, RECEIPT);
    expect(res.body.estimate).toEqual(DETAIL.estimate);
    expect(res.body.quote).toEqual(DETAIL.quote);
    expect(JSON.stringify(res.body)).not.toMatch(/status|memo|admin|customer_id|edit_seq|has_unpublished/i);
  });

  it('answers the same 404 for a request that is not the customer\'s, one that does not exist and a bad number', async () => {
    mocked(getOwnEstimate).mockResolvedValue(null);

    const other = await request(app).get(`/api/customers/me/estimates/${RECEIPT}`).set('Cookie', COOKIE);
    const bad = await request(app).get('/api/customers/me/estimates/not-a-receipt').set('Cookie', COOKIE);
    const injection = await request(app).get(`/api/customers/me/estimates/${encodeURIComponent("BP1' OR 1=1 --")}`).set('Cookie', COOKIE);

    for (const res of [other, bad, injection]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ESTIMATE_NOT_FOUND');
    }
    expect(mocked(getOwnEstimate).mock.calls).toHaveLength(1);
  });

  it('is never stored by a browser or a proxy', async () => {
    const res = await request(app).get('/api/customers/me/estimates').set('Cookie', COOKIE);

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 500 without the text of the error', async () => {
    mocked(listOwnEstimates).mockRejectedValue(new Error('relation "estimates" does not exist'));

    const res = await request(app).get('/api/customers/me/estimates').set('Cookie', COOKIE);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});
