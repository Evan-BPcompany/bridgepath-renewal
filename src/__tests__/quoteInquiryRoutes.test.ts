jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerAuthService', () => ({
  ...jest.requireActual('../services/customerAuthService'),
  findSessionCustomer: jest.fn()
}));
jest.mock('../services/customerQuoteService', () => ({ listOwnEstimates: jest.fn(), getOwnEstimate: jest.fn() }));
jest.mock('../services/quoteInquiryService', () => ({
  ...jest.requireActual('../services/quoteInquiryService'),
  createInquiry: jest.fn(),
  listInquiries: jest.fn(),
  answerQuestion: jest.fn(),
  completeConsultation: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { findSessionCustomer } from '../services/customerAuthService';
import * as service from '../services/quoteInquiryService';
import { InquiryError } from '../services/quoteInquiryService';
import { ADMIN_ID, MANAGER_ID, ESTIMATE_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

const mocked = (fn: unknown) => fn as jest.Mock;
const CUSTOMER_ID = 'c0000000-0000-0000-0000-0000000000c1';
const COOKIE = `bp_session=${'a'.repeat(64)}`;
const RECEIPT = 'BP20261021001';
const INQUIRY_ID = 'd0000000-0000-0000-0000-000000000001';
const URL = `/api/customers/me/estimates/${RECEIPT}/inquiries`;

const OWN = {
  id: INQUIRY_ID, kind: 'question', quote_version: 1, body: '납기를 줄일 수 있나요?', phone: null, preferred_time: null,
  status: 'open', answer: null, created_at: '2026-10-22T00:00:00.000Z', handled_at: null
};

describe('POST /api/customers/me/estimates/:receipt_id/inquiries (mocked service)', () => {
  let app: Express;
  const send = (body: unknown, cookie: string | undefined = COOKIE, url = URL) => {
    const req = request(app).post(url);
    return (cookie ? req.set('Cookie', cookie) : req).send(body as object);
  };

  beforeEach(() => {
    [findSessionCustomer, service.createInquiry].forEach(fn => mocked(fn).mockReset());
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    app = createApp({ rateLimits: { customerInquiry: { windowMs: 60_000, max: 100000 } } });
    mocked(findSessionCustomer).mockResolvedValue({
      customer: { id: CUSTOMER_ID, email: 'buyer@example.com', consent_required: false, phone_required: false },
      sessionId: 's1'
    });
    mocked(service.createInquiry).mockResolvedValue(OWN);
  });

  afterEach(() => jest.restoreAllMocks());

  it('needs a signed-in customer', async () => {
    mocked(findSessionCustomer).mockResolvedValue(undefined);

    const res = await send({ kind: 'question', body: 'x' });

    expect(res.status).toBe(401);
    expect(service.createInquiry).not.toHaveBeenCalled();
  });

  it('sends a question for the customer of the session, never for one the body names', async () => {
    const res = await send({ kind: 'question', body: '  납기를 줄일 수 있나요? ', customer_id: 'c0000000-0000-0000-0000-0000000000ff' });

    expect(res.status).toBe(201);
    expect(res.body.inquiry).toEqual(OWN);
    expect(service.createInquiry).toHaveBeenCalledWith(CUSTOMER_ID, RECEIPT, { kind: 'question', body: '납기를 줄일 수 있나요?' });
  });

  it('sends a request for a consultation with the phone, the time and the note', async () => {
    mocked(service.createInquiry).mockResolvedValue({ ...OWN, kind: 'consultation', body: null, phone: '010-1234-5678', preferred_time: 'weekday_am' });

    const res = await send({ kind: 'consultation', phone: '010-1234-5678', preferred_time: 'weekday_am' });

    expect(res.status).toBe(201);
    expect(service.createInquiry).toHaveBeenCalledWith(CUSTOMER_ID, RECEIPT, {
      kind: 'consultation', phone: '010-1234-5678', preferred_time: 'weekday_am', body: null
    });
  });

  it('refuses a question over 300 characters, an empty one and a bad phone, and sends nothing on', async () => {
    const tooLong = await send({ kind: 'question', body: '가'.repeat(301) });
    const empty = await send({ kind: 'question', body: '   ' });
    const badPhone = await send({ kind: 'consultation', phone: 'x' });
    const noKind = await send({ body: 'x' });

    for (const res of [tooLong, empty, badPhone, noKind]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(tooLong.body.details[0].field).toBe('body');
    expect(badPhone.body.details[0].field).toBe('phone');
    expect(service.createInquiry).not.toHaveBeenCalled();
  });

  it('takes JSON only: a form post is refused', async () => {
    const res = await request(app).post(URL).set('Cookie', COOKIE).type('form').send('kind=question&body=x');

    expect(res.status).toBe(415);
    expect(service.createInquiry).not.toHaveBeenCalled();
  });

  it('is a plain 404 for a receipt number that cannot be one', async () => {
    const res = await send({ kind: 'question', body: 'x' }, COOKIE, '/api/customers/me/estimates/not-a-receipt/inquiries');

    expect(res.status).toBe(404);
    expect(service.createInquiry).not.toHaveBeenCalled();
  });

  it.each([
    ['ESTIMATE_NOT_FOUND', 404],
    ['NO_QUOTE', 409],
    ['ALREADY_OPEN', 409],
    ['TOO_MANY', 429]
  ] as const)('answers %s with %i', async (code, status) => {
    mocked(service.createInquiry).mockRejectedValue(new InquiryError(code));

    const res = await send({ kind: 'question', body: 'x' });

    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });

  it('answers 500 without the text of the error', async () => {
    mocked(service.createInquiry).mockRejectedValue(new Error('relation "quote_inquiries" does not exist'));

    const res = await send({ kind: 'question', body: 'x' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});

describe('/admin/estimates/:id/inquiries (mocked service)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const BASE = `/admin/estimates/${ESTIMATE_ID}/inquiries`;
  const ADMIN_VIEW = { ...OWN, handled_by: null };
  const audit = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  beforeEach(() => {
    [service.listInquiries, service.answerQuestion, service.completeConsultation].forEach(fn => mocked(fn).mockReset());
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    mocked(service.listInquiries).mockResolvedValue([ADMIN_VIEW]);
    mocked(service.answerQuestion).mockResolvedValue({ ...ADMIN_VIEW, status: 'answered', answer: '가능합니다.' });
    mocked(service.completeConsultation).mockResolvedValue({ ...ADMIN_VIEW, kind: 'consultation', status: 'done' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('is for staff only', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).post(`${BASE}/${INQUIRY_ID}/answer`).send({ answer: 'x' })).status).toBe(401);
    expect((await request(app).get(BASE).set('Cookie', COOKIE)).status).toBe(401);
    expect(service.listInquiries).not.toHaveBeenCalled();
    expect(service.answerQuestion).not.toHaveBeenCalled();
  });

  it('lists what the customer asked, for a manager as for an admin', async () => {
    const res = await request(app).get(BASE).set('Cookie', authCookie('manager'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([ADMIN_VIEW]);
    expect(service.listInquiries).toHaveBeenCalledWith(ESTIMATE_ID);
  });

  it('is 404 for an estimate that does not exist and 400 for an id that is not a UUID', async () => {
    mocked(service.listInquiries).mockResolvedValue(null);

    expect((await request(app).get(BASE).set('Cookie', authCookie('admin'))).status).toBe(404);
    expect((await request(app).get('/admin/estimates/x/inquiries').set('Cookie', authCookie('admin'))).status).toBe(400);
    expect((await request(app).post(`${BASE}/not-a-uuid/answer`).set('Cookie', authCookie('admin')).send({ answer: 'x' })).status).toBe(400);
  });

  describe('answering a question', () => {
    const answer = (body: unknown, role: 'admin' | 'manager' = 'manager') =>
      request(app).post(`${BASE}/${INQUIRY_ID}/answer`).set('Cookie', authCookie(role)).send(body as object);

    it('records the answer by the admin of the session, and audits it without the words', async () => {
      const res = await answer({ answer: '  가능합니다.  ', handled_by: 'someone-else' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'answered', answer: '가능합니다.' });
      expect(service.answerQuestion).toHaveBeenCalledWith(ESTIMATE_ID, INQUIRY_ID, MANAGER_ID, '가능합니다.');
      const entry = audit().find(item => item.action === 'inquiry.answer')!;
      expect(entry).toMatchObject({ result: 'success', admin_id: MANAGER_ID, estimate_id: ESTIMATE_ID, inquiry_id: INQUIRY_ID });
      expect(JSON.stringify(entry)).not.toContain('가능');
    });

    it('needs an answer of up to 500 characters', async () => {
      for (const body of [{}, { answer: '' }, { answer: '가'.repeat(501) }, { answer: 5 }]) {
        const res = await answer(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(service.answerQuestion).not.toHaveBeenCalled();
    });

    it('wants JSON', async () => {
      const res = await request(app).post(`${BASE}/${INQUIRY_ID}/answer`).set('Cookie', authCookie('admin')).type('form').send('answer=x');
      expect(res.status).toBe(415);
    });

    it.each([
      ['INQUIRY_NOT_FOUND', 404],
      ['WRONG_KIND', 409],
      ['ALREADY_HANDLED', 409]
    ] as const)('answers %s with %i and audits the refusal', async (code, status) => {
      mocked(service.answerQuestion).mockRejectedValue(new InquiryError(code));

      const res = await answer({ answer: 'x' }, 'admin');

      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(audit().find(item => item.action === 'inquiry.answer')).toMatchObject({ result: 'denied', error_code: code, admin_id: ADMIN_ID });
    });
  });

  describe('closing a consultation', () => {
    const done = (body: unknown) => request(app).post(`${BASE}/${INQUIRY_ID}/done`).set('Cookie', authCookie('manager')).send(body as object);

    it('marks it done with an optional note', async () => {
      const res = await done({ note: '  내일 다시 통화  ' });

      expect(res.status).toBe(200);
      expect(service.completeConsultation).toHaveBeenCalledWith(ESTIMATE_ID, INQUIRY_ID, MANAGER_ID, '내일 다시 통화');
      expect(audit().find(item => item.action === 'inquiry.done')).toMatchObject({ result: 'success', inquiry_id: INQUIRY_ID });
    });

    it('needs no note, and refuses one over 300 characters', async () => {
      expect((await done({})).status).toBe(200);
      expect(service.completeConsultation).toHaveBeenLastCalledWith(ESTIMATE_ID, INQUIRY_ID, MANAGER_ID, null);
      expect((await done({ note: '가'.repeat(301) })).status).toBe(400);
    });

    it('answers 409 for one that was handled already', async () => {
      mocked(service.completeConsultation).mockRejectedValue(new InquiryError('ALREADY_HANDLED'));

      const res = await done({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_HANDLED');
    });
  });
});
