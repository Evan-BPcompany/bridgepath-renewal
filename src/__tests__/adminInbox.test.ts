jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/quoteInquiryService', () => ({
  ...jest.requireActual('../services/quoteInquiryService'),
  listInbox: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { parseInboxQuery } from '../middleware/adminValidation';
import * as service from '../services/quoteInquiryService';
import { authCookie, createFakeDb } from './helpers/adminTestUtils';

const mocked = (fn: unknown) => fn as jest.Mock;
const ITEM = {
  id: '6a000000-0000-4000-8000-000000000001', kind: 'question', quote_version: 1, body: '납기를 줄일 수 있나요?', phone: null, preferred_time: null,
  status: 'open', answer: null, created_at: '2026-10-22T05:00:00.000Z', handled_at: null, handled_by: null,
  estimate: { id: 'c0000000-0000-0000-0000-000000000001', receipt_id: 'BP20261021001', category: 'eyewear', customer_name: 'Kim', company_name: 'Acme' }
};

describe('parseInboxQuery', () => {
  const parse = (query: Record<string, unknown>) => parseInboxQuery(query as never);

  it('shows what waits for the staff, first page, when nothing is asked', () => {
    expect(parse({})).toEqual({ valid: true, value: { status: 'open', kind: undefined, page: 1, limit: 20 } });
  });

  it('takes the three statuses, the two kinds, the page and the limit', () => {
    expect(parse({ status: 'handled', kind: 'consultation', page: '3', limit: '50' })).toEqual({
      valid: true, value: { status: 'handled', kind: 'consultation', page: 3, limit: 50 }
    });
    expect(parse({ status: 'all' })).toMatchObject({ valid: true, value: { status: 'all' } });
    expect(parse({ status: '  ', kind: ' ' })).toMatchObject({ valid: true, value: { status: 'open', kind: undefined } });
  });

  it.each([
    [{ status: 'closed' }, 'status'],
    [{ status: 'open,handled' }, 'status'],
    [{ status: ['open', 'all'] }, 'status'],
    [{ kind: 'complaint' }, 'kind'],
    [{ kind: ['question'] }, 'kind'],
    [{ page: '0' }, 'page'],
    [{ page: '-1' }, 'page'],
    [{ page: 'x' }, 'page'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '101' }, 'limit']
  ])('refuses %j', (query, field) => {
    const result = parse(query);
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.errors.map(e => e.field)).toContain(field);
  });
});

describe('GET /admin/inquiries (mocked service)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    mocked(service.listInbox).mockReset();
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    mocked(service.listInbox).mockResolvedValue({ items: [ITEM], total: 45, counts: { open_questions: 3, open_consultations: 2 } });
  });

  afterEach(() => jest.restoreAllMocks());

  it('is for staff only', async () => {
    expect((await request(app).get('/admin/inquiries')).status).toBe(401);
    expect((await request(app).get('/admin/inquiries').set('Cookie', `bp_session=${'a'.repeat(64)}`)).status).toBe(401);
    expect(service.listInbox).not.toHaveBeenCalled();
  });

  it('lists what waits, with the counts of what waits whatever the filter, and the paging', async () => {
    const res = await request(app).get('/admin/inquiries').set('Cookie', authCookie('manager'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [ITEM],
      counts: { open_questions: 3, open_consultations: 2 },
      pagination: { page: 1, limit: 20, total: 45, total_pages: 3 }
    });
    expect(service.listInbox).toHaveBeenCalledWith({ status: 'open', kind: undefined, page: 1, limit: 20 });
  });

  it('passes the filters on, for an admin as for a manager', async () => {
    await request(app).get('/admin/inquiries?status=handled&kind=question&page=2&limit=10').set('Cookie', authCookie('admin'));

    expect(service.listInbox).toHaveBeenCalledWith({ status: 'handled', kind: 'question', page: 2, limit: 10 });
  });

  it('refuses a query that is not valid, with the fields', async () => {
    const res = await request(app).get('/admin/inquiries?status=closed&limit=500').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['limit', 'status']);
    expect(service.listInbox).not.toHaveBeenCalled();
  });

  it('is never stored by a browser or a proxy', async () => {
    const res = await request(app).get('/admin/inquiries').set('Cookie', authCookie('admin'));

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 500 without the text of the error', async () => {
    mocked(service.listInbox).mockRejectedValue(new Error('relation "quote_inquiries" does not exist'));

    const res = await request(app).get('/admin/inquiries').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('relation');
  });
});
