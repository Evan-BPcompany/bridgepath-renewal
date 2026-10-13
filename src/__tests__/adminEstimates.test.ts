jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { buildListWhere } from '../services/adminEstimateService';
import { parseListQuery } from '../middleware/adminValidation';
import {
  ADMIN_ID,
  MANAGER_ID,
  ESTIMATE_ID,
  authCookie,
  createFakeDb,
  sqlOf
} from './helpers/adminTestUtils';

const FORBIDDEN_KEYS = [
  's3_key',
  'virus_scan_result',
  'password_hash',
  'access_token',
  'access_token_hash',
  'refresh_token',
  'refresh_token_hash',
  'token',
  'token_hash'
];

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach(v => collectKeys(v, keys));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
  return keys;
}

function loggedText(...spies: jest.SpyInstance[]): string {
  return spies.flatMap(spy => spy.mock.calls.map(call => JSON.stringify(call))).join('\n');
}

describe('Admin estimates API (mocked database)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authentication', () => {
    const endpoints: Array<[string, string]> = [
      ['get', '/admin/estimates'],
      ['get', `/admin/estimates/${ESTIMATE_ID}`],
      ['patch', `/admin/estimates/${ESTIMATE_ID}/status`]
    ];

    it.each(endpoints)('%s %s returns 401 without a cookie', async (method, url) => {
      const res = await (request(app) as any)[method](url).send({ to_status: 'under_review' });
      expect(res.status).toBe(401);
    });

    it.each(endpoints)('%s %s returns 401 for a garbage token', async (method, url) => {
      const res = await (request(app) as any)[method](url)
        .set('Cookie', 'access_token=not-a-jwt')
        .send({ to_status: 'under_review' });
      expect(res.status).toBe(401);
    });

    it('returns 401 for a revoked session', async () => {
      db.state.sessionRevoked = true;
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired session', async () => {
      db.state.sessionExpired = true;
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
      expect(res.status).toBe(401);
    });

    it('returns 401 for a missing session', async () => {
      db.state.sessionMissing = true;
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
      expect(res.status).toBe(401);
    });

    it('returns 401 for an inactive admin account', async () => {
      db.state.adminInactive = true;
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
      expect(res.status).toBe(401);
    });

    it('runs no estimate query for unauthenticated requests', async () => {
      await request(app).get('/admin/estimates');
      expect(sqlOf(db.state).filter(s => s.includes('FROM estimates'))).toHaveLength(0);
    });
  });

  describe('GET /admin/estimates (list)', () => {
    const row = {
      id: ESTIMATE_ID,
      receipt_id: 'BP20261013001',
      category: 'eyewear',
      status: 'new_receipt',
      company_name: 'Acme',
      customer_name: 'Kim',
      customer_email: 'buyer@example.com',
      customer_phone: '010-1234-5678',
      specification_json: { secret: 'spec' },
      created_at: new Date('2026-10-13T01:00:00Z'),
      updated_at: new Date('2026-10-13T02:00:00Z'),
      file_count: 2
    };

    beforeEach(() => {
      db.state.handler = sql => {
        if (sql.includes('COUNT(*)::int AS total')) {
          return { rows: [{ total: 45 }] };
        }
        if (sql.includes('ORDER BY')) {
          return { rows: [row] };
        }
        return undefined;
      };
    });

    it('applies defaults and returns pagination metadata', async () => {
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('manager'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 45, total_pages: 3 });

      const listQuery = db.state.queries.find(q => q.sql.includes('ORDER BY'))!;
      expect(listQuery.sql).toContain('ORDER BY e.created_at DESC, e.id ASC');
      expect(listQuery.params).toEqual([20, 0]);
    });

    it('returns minimal personal data in the list', async () => {
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));

      expect(res.body.data).toHaveLength(1);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(
        [
          'category',
          'company_name',
          'created_at',
          'customer_name',
          'file_count',
          'id',
          'receipt_id',
          'status',
          'updated_at'
        ].sort()
      );
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('buyer@example.com');
      expect(text).not.toContain('010-1234-5678');
      expect(text).not.toContain('secret');
    });

    it('passes filters, search, sort and paging to the query', async () => {
      const res = await request(app)
        .get('/admin/estimates')
        .query({
          status: 'new_receipt,quoted',
          category: 'shoes',
          created_from: '2026-10-01',
          created_to: '2026-10-13',
          q: 'acme',
          sort: 'receipt_id',
          order: 'asc',
          page: '3',
          limit: '10'
        })
        .set('Cookie', authCookie('admin'));

      expect(res.status).toBe(200);

      const listQuery = db.state.queries.find(q => q.sql.includes('ORDER BY'))!;
      expect(listQuery.sql).toContain('ORDER BY e.receipt_id ASC, e.id ASC');
      expect(listQuery.params).toEqual([
        ['new_receipt', 'quoted'],
        'shoes',
        '2026-10-01',
        '2026-10-13',
        'acme%',
        '%acme%',
        10,
        20
      ]);
    });

    it.each([
      [{ status: 'bogus' }],
      [{ status: 'new_receipt,bogus' }],
      [{ category: 'cars' }],
      [{ limit: '101' }],
      [{ limit: '0' }],
      [{ page: '0' }],
      [{ page: 'abc' }],
      [{ created_from: '2026-13-01' }],
      [{ created_to: '2026-02-30' }],
      [{ created_from: '2026-10-13', created_to: '2026-10-01' }],
      [{ sort: 'created_at; DROP TABLE estimates' }],
      [{ sort: 'customer_email' }],
      [{ order: 'sideways' }],
      [{ q: 'x'.repeat(101) }]
    ])('rejects invalid query %j with 400', async query => {
      const res = await request(app)
        .get('/admin/estimates')
        .query(query)
        .set('Cookie', authCookie('admin'));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(sqlOf(db.state).filter(s => s.includes('FROM estimates'))).toHaveLength(0);
    });

    it('rejects repeated query parameters', async () => {
      const res = await request(app)
        .get('/admin/estimates?status=quoted&status=accepted')
        .set('Cookie', authCookie('admin'));
      expect(res.status).toBe(400);
    });
  });

  describe('list query building', () => {
    const parse = (query: Record<string, string>) => {
      const result = parseListQuery(query);
      if (!result.valid) {
        throw new Error('expected valid query');
      }
      return result.value;
    };

    it('builds an empty WHERE clause with no filters', () => {
      expect(buildListWhere(parse({}))).toEqual({ clause: '', params: [] });
    });

    it('treats Korea-time date boundaries inclusively', () => {
      const { clause, params } = buildListWhere(
        parse({ created_from: '2026-10-01', created_to: '2026-10-13' })
      );
      expect(clause).toContain("e.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Seoul'");
      expect(clause).toContain("e.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')");
      expect(params).toEqual(['2026-10-01', '2026-10-13']);
    });

    it('escapes LIKE wildcards in the search term', () => {
      const { params } = buildListWhere(parse({ q: 'a%b_c\\d' }));
      expect(params).toEqual(['a\\%b\\_c\\\\d%', '%a\\%b\\_c\\\\d%']);
    });

    it('adds a digits-only phone match for phone-like searches', () => {
      const { clause, params } = buildListWhere(parse({ q: '010-1234-5678' }));
      expect(clause).toContain("regexp_replace(coalesce(e.customer_phone, ''), '\\D', '', 'g')");
      expect(params[params.length - 1]).toBe('%01012345678%');
    });

    it('does not add the phone match for short or text searches', () => {
      expect(buildListWhere(parse({ q: '123' })).clause).not.toContain('regexp_replace');
      expect(buildListWhere(parse({ q: 'acme' })).clause).not.toContain('regexp_replace');
    });

    it('never places user text into the SQL string', () => {
      const { clause } = buildListWhere(
        parse({ q: "'; DROP TABLE estimates; --", category: 'shoes' })
      );
      expect(clause).not.toContain('DROP');
      expect(clause).not.toContain("'; ");
    });
  });

  describe('GET /admin/estimates/:id (detail)', () => {
    const detailRows = () => {
      db.state.handler = sql => {
        if (sql.includes('FROM estimates WHERE id')) {
          return {
            rows: [
              {
                id: ESTIMATE_ID,
                receipt_id: 'BP20261013001',
                category: 'eyewear',
                status: 'quoted',
                customer_name: 'Kim',
                customer_email: 'buyer@example.com',
                customer_phone: '010-1234-5678',
                company_name: 'Acme',
                specification_json: { quantity: 100 },
                is_consultation: false,
                created_at: new Date('2026-10-13T01:00:00Z'),
                updated_at: new Date('2026-10-13T02:00:00Z')
              }
            ]
          };
        }
        if (sql.includes('FROM files')) {
          return {
            rows: [
              {
                id: 'f0000000-0000-0000-0000-000000000001',
                filename: 'logo.png',
                file_size: '2048',
                mime_type: 'image/png',
                file_status: 'quarantine',
                virus_scan_status: 'pending',
                uploaded_at: new Date('2026-10-13T01:00:00Z'),
                s3_key: 'estimates/x/y.png',
                virus_scan_result: 'internal scanner output'
              }
            ]
          };
        }
        if (sql.includes('FROM status_history')) {
          return {
            rows: [
              {
                id: 'h1',
                old_status: 'new_receipt',
                new_status: 'under_review',
                reason: null,
                created_at: new Date('2026-10-13T01:30:00Z'),
                changed_by: ADMIN_ID,
                changed_by_username: 'master'
              }
            ]
          };
        }
        if (sql.includes('FROM admin_memos')) {
          return {
            rows: [
              {
                id: 'm1',
                content: 'Called the customer',
                created_at: new Date('2026-10-13T01:40:00Z'),
                admin_user_id: MANAGER_ID,
                author_username: 'staff'
              }
            ]
          };
        }
        return undefined;
      };
    };

    it('rejects a non-UUID id with 400 INVALID_ID', async () => {
      const res = await request(app)
        .get('/admin/estimates/BP20261013001')
        .set('Cookie', authCookie('admin'));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ID');
      expect(sqlOf(db.state).filter(s => s.includes('FROM estimates'))).toHaveLength(0);
    });

    it('returns 404 for an unknown estimate and audits the attempt', async () => {
      const res = await request(app)
        .get(`/admin/estimates/${ESTIMATE_ID}`)
        .set('Cookie', authCookie('admin'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ESTIMATE_NOT_FOUND');
      const messages = warnSpy.mock.calls.map(call => String(call[0]));
      expect(messages.some(m => m.startsWith('admin_audit') && m.includes('"result":"not_found"'))).toBe(true);
    });

    it('returns estimate, file metadata, history and memos to both roles', async () => {
      detailRows();

      for (const role of ['admin', 'manager'] as const) {
        const res = await request(app)
          .get(`/admin/estimates/${ESTIMATE_ID}`)
          .set('Cookie', authCookie(role));

        expect(res.status).toBe(200);
        const { estimate, files, status_history, memos } = res.body.data;

        expect(estimate.receipt_id).toBe('BP20261013001');
        expect(estimate.customer_email).toBe('buyer@example.com');
        expect(estimate.customer_phone).toBe('010-1234-5678');
        expect(files).toEqual([
          {
            id: 'f0000000-0000-0000-0000-000000000001',
            filename: 'logo.png',
            file_size: 2048,
            mime_type: 'image/png',
            file_status: 'quarantine',
            virus_scan_status: 'pending',
            uploaded_at: '2026-10-13T01:00:00.000Z',
            downloadable: false
          }
        ]);
        expect(status_history[0].changed_by).toEqual({ id: ADMIN_ID, username: 'master' });
        expect(memos[0].author).toEqual({ id: MANAGER_ID, username: 'staff' });
      }
    });

    it('never returns or selects secrets', async () => {
      detailRows();

      const res = await request(app)
        .get(`/admin/estimates/${ESTIMATE_ID}`)
        .set('Cookie', authCookie('admin'));

      const keys = collectKeys(res.body);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect(JSON.stringify(res.body)).not.toContain('estimates/x/y.png');
      expect(JSON.stringify(res.body)).not.toContain('internal scanner output');

      const allSql = sqlOf(db.state).join('\n');
      for (const column of ['s3_key', 'virus_scan_result', 'password_hash', 'estimate_access_tokens']) {
        expect(allSql).not.toContain(column);
      }
    });

    it('audits successful detail views without personal data', async () => {
      detailRows();

      await request(app)
        .get(`/admin/estimates/${ESTIMATE_ID}`)
        .set('Cookie', authCookie('manager'));

      const auditCall = infoSpy.mock.calls.find(call => String(call[0]).startsWith('admin_audit'));
      expect(auditCall).toBeDefined();

      const record = JSON.parse(String(auditCall![0]).replace('admin_audit ', ''));
      expect(record).toMatchObject({
        action: 'estimate.detail.view',
        result: 'success',
        admin_id: MANAGER_ID,
        role: 'manager',
        estimate_id: ESTIMATE_ID
      });

      const text = loggedText(infoSpy, warnSpy);
      expect(text).not.toContain('buyer@example.com');
      expect(text).not.toContain('010-1234-5678');
      expect(text).not.toContain('Called the customer');
    });
  });

  describe('PATCH /admin/estimates/:id/status', () => {
    let dbStatus: string;

    const patch = (
      body: unknown,
      role: 'admin' | 'manager' = 'admin',
      id: string = ESTIMATE_ID
    ) =>
      request(app)
        .patch(`/admin/estimates/${id}/status`)
        .set('Cookie', authCookie(role))
        .send(body as object);

    beforeEach(() => {
      dbStatus = 'new_receipt';
      db.state.handler = (sql, params) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ id: ESTIMATE_ID, receipt_id: 'BP20261013001', status: dbStatus }] };
        }
        if (sql.includes('UPDATE estimates')) {
          dbStatus = params[1] as string;
          return { rows: [{ updated_at: new Date('2026-10-13T03:00:00Z') }] };
        }
        if (sql.includes('INSERT INTO status_history')) {
          return { rows: [{ id: 'hist-1' }] };
        }
        return undefined;
      };
    });

    it('changes status, writes history and commits in one transaction', async () => {
      const res = await patch({ to_status: 'under_review' }, 'manager');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        id: ESTIMATE_ID,
        receipt_id: 'BP20261013001',
        previous_status: 'new_receipt',
        status: 'under_review',
        updated_at: '2026-10-13T03:00:00.000Z',
        history_id: 'hist-1'
      });

      const order = db.client.query.mock.calls.map(call => String(call[0]).trim().split(/\s+/)[0]);
      expect(order[0]).toBe('BEGIN');
      expect(order[order.length - 1]).toBe('COMMIT');

      const lock = db.state.queries.find(q => q.sql.includes('FOR UPDATE'))!;
      expect(lock.sql).toContain('FROM estimates WHERE id = $1 FOR UPDATE');

      const update = db.state.queries.find(q => q.sql.includes('UPDATE estimates'))!;
      expect(update.sql).toContain('updated_at = CURRENT_TIMESTAMP');

      const history = db.state.queries.find(q => q.sql.includes('INSERT INTO status_history'))!;
      expect(history.params).toEqual([ESTIMATE_ID, 'new_receipt', 'under_review', MANAGER_ID, null]);
      expect(db.client.release).toHaveBeenCalled();
    });

    it('stores a trimmed reason in status_history', async () => {
      dbStatus = 'under_review';
      const res = await patch({ to_status: 'on_hold', reason: '  waiting for sample  ' }, 'manager');

      expect(res.status).toBe(200);
      const history = db.state.queries.find(q => q.sql.includes('INSERT INTO status_history'))!;
      expect(history.params[4]).toBe('waiting for sample');
    });

    it('returns 400 INVALID_ID for a non-UUID id', async () => {
      const res = await patch({ to_status: 'under_review' }, 'admin', 'BP20261013001');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ID');
    });

    it('returns 400 INVALID_STATUS for unknown status values', async () => {
      const unknown = await patch({ to_status: 'shipped' });
      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe('INVALID_STATUS');

      const expected = await patch({ to_status: 'under_review', expected_status: 'shipped' });
      expect(expected.status).toBe(400);
      expect(expected.body.code).toBe('INVALID_STATUS');

      const notString = await patch({ to_status: 5 });
      expect(notString.body.code).toBe('INVALID_STATUS');
    });

    it('returns 400 VALIDATION_ERROR for malformed bodies', async () => {
      const bodies: unknown[] = [
        {},
        [],
        { to_status: 'on_hold', reason: 123 },
        { to_status: 'on_hold', reason: 'x'.repeat(1001) },
        { to_status: 'on_hold', reason: 'bad\u0000char' }
      ];

      for (const body of bodies) {
        const res = await patch(body);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
      expect(sqlOf(db.state).filter(s => s.includes('FOR UPDATE'))).toHaveLength(0);
    });

    it('returns 400 INVALID_JSON for malformed JSON', async () => {
      const res = await request(app)
        .patch(`/admin/estimates/${ESTIMATE_ID}/status`)
        .set('Cookie', authCookie('admin'))
        .set('Content-Type', 'application/json')
        .send('{"to_status": ');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_JSON');
    });

    it('returns 415 for non-JSON content types', async () => {
      const res = await request(app)
        .patch(`/admin/estimates/${ESTIMATE_ID}/status`)
        .set('Cookie', authCookie('admin'))
        .type('form')
        .send('to_status=under_review');

      expect(res.status).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(sqlOf(db.state).filter(s => s.includes('FOR UPDATE'))).toHaveLength(0);
    });

    it('returns 404 ESTIMATE_NOT_FOUND', async () => {
      db.state.handler = () => undefined;
      const res = await patch({ to_status: 'under_review' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ESTIMATE_NOT_FOUND');
      expect(db.client.query.mock.calls.map(c => String(c[0]).trim())).toContain('ROLLBACK');
    });

    it('returns 409 STATUS_CONFLICT with the current status when expected_status differs', async () => {
      dbStatus = 'under_review';
      const res = await patch({ to_status: 'quoted', expected_status: 'new_receipt' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STATUS_CONFLICT');
      expect(res.body.current_status).toBe('under_review');
      expect(sqlOf(db.state).filter(s => s.includes('UPDATE estimates'))).toHaveLength(0);
      expect(sqlOf(db.state).filter(s => s.includes('INSERT INTO status_history'))).toHaveLength(0);
    });

    it('checks expected_status before the same-status rule', async () => {
      dbStatus = 'quoted';
      const res = await patch({ to_status: 'quoted', expected_status: 'under_review' });
      expect(res.status).toBe(409);
    });

    it('returns 422 SAME_STATUS when the status does not change', async () => {
      const res = await patch({ to_status: 'new_receipt' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('SAME_STATUS');
    });

    it('returns 422 INVALID_TRANSITION for transitions outside the table', async () => {
      const res = await patch({ to_status: 'completed', reason: 'skip ahead' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(sqlOf(db.state).filter(s => s.includes('UPDATE estimates'))).toHaveLength(0);
    });

    it('returns 403 INSUFFICIENT_ROLE for a manager on admin-only transitions', async () => {
      const res = await patch({ to_status: 'cancelled', reason: 'customer asked' }, 'manager');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INSUFFICIENT_ROLE');
      expect(sqlOf(db.state).filter(s => s.includes('UPDATE estimates'))).toHaveLength(0);
    });

    it('lets an admin perform the same admin-only transition', async () => {
      const res = await patch({ to_status: 'cancelled', reason: 'customer asked' }, 'admin');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('returns 422 REASON_REQUIRED when a reason is mandatory', async () => {
      dbStatus = 'under_review';
      const res = await patch({ to_status: 'on_hold' }, 'manager');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('REASON_REQUIRED');

      const blank = await patch({ to_status: 'on_hold', reason: '   ' }, 'manager');
      expect(blank.body.code).toBe('REASON_REQUIRED');
    });

    it('requires a reason for accepted -> completed', async () => {
      dbStatus = 'accepted';
      const missing = await patch({ to_status: 'completed' }, 'manager');
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe('REASON_REQUIRED');

      const ok = await patch({ to_status: 'completed', reason: 'contract closed' }, 'manager');
      expect(ok.status).toBe(200);
    });

    it('rolls back and returns 500 when the history insert fails', async () => {
      db.state.handler = (sql, params) => {
        if (sql.includes('FOR UPDATE')) {
          return { rows: [{ id: ESTIMATE_ID, receipt_id: 'BP20261013001', status: 'new_receipt' }] };
        }
        if (sql.includes('UPDATE estimates')) {
          return { rows: [{ updated_at: new Date(), status: params[1] }] };
        }
        if (sql.includes('INSERT INTO status_history')) {
          throw new Error('insert failed');
        }
        return undefined;
      };

      const res = await patch({ to_status: 'under_review' });

      expect(res.status).toBe(500);
      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements).toContain('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(db.client.release).toHaveBeenCalled();
    });

    it('rejects the second of two sequential changes made from the same starting status', async () => {
      const first = await patch({ to_status: 'under_review', expected_status: 'new_receipt' }, 'manager');
      const second = await patch({ to_status: 'rejected', reason: 'duplicate', expected_status: 'new_receipt' }, 'admin');

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body.current_status).toBe('under_review');
    });

    it('audits success and denial without logging the reason text', async () => {
      await patch({ to_status: 'under_review', reason: 'top secret reason text' }, 'manager');
      await patch({ to_status: 'cancelled', reason: 'top secret reason text' }, 'manager');

      const records = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
        .map(call => String(call[0]))
        .filter(message => message.startsWith('admin_audit'))
        .map(message => JSON.parse(message.replace('admin_audit ', '')));

      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        action: 'estimate.status.change',
        result: 'success',
        from_status: 'new_receipt',
        to_status: 'under_review',
        admin_id: MANAGER_ID,
        role: 'manager'
      });
      expect(records[1]).toMatchObject({
        action: 'estimate.status.change',
        result: 'denied',
        http_status: 403,
        error_code: 'INSUFFICIENT_ROLE'
      });

      expect(loggedText(infoSpy, warnSpy)).not.toContain('top secret reason text');
    });
  });
});
