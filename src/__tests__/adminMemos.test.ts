jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { parseMemoBody, MEMO_MAX_LENGTH } from '../middleware/adminValidation';
import {
  ADMIN_ID,
  MANAGER_ID,
  ESTIMATE_ID,
  authCookie,
  createFakeDb,
  sqlOf
} from './helpers/adminTestUtils';

const MEMO_URL = `/admin/estimates/${ESTIMATE_ID}/memos`;

describe('Admin memos API (mocked database)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const auditRecords = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);

    db.state.handler = (sql, params) => {
      if (sql.includes('INSERT INTO admin_memos')) {
        return {
          rows: [
            {
              id: 'm0000000-0000-0000-0000-000000000001',
              estimate_id: params[0],
              content: params[2],
              created_at: new Date('2026-10-13T05:00:00Z')
            }
          ]
        };
      }
      if (sql.includes('SELECT 1 FROM estimates')) {
        return { rows: [{ '?column?': 1 }] };
      }
      if (sql.includes('COUNT(*)::int AS total FROM admin_memos')) {
        return { rows: [{ total: 45 }] };
      }
      if (sql.includes('FROM admin_memos m')) {
        return {
          rows: [
            {
              id: 'm1',
              content: 'Called the customer',
              created_at: new Date('2026-10-13T04:00:00Z'),
              admin_user_id: MANAGER_ID,
              author_username: 'staff'
            }
          ]
        };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authentication', () => {
    it.each([['get'], ['post']])('%s returns 401 without a valid session', async method => {
      const none = await (request(app) as any)[method](MEMO_URL).send({ content: 'x' });
      expect(none.status).toBe(401);

      db.state.sessionRevoked = true;
      const revoked = await (request(app) as any)[method](MEMO_URL)
        .set('Cookie', authCookie('admin'))
        .send({ content: 'x' });
      expect(revoked.status).toBe(401);

      expect(sqlOf(db.state).filter(s => s.includes('admin_memos'))).toHaveLength(0);
    });
  });

  describe('POST /admin/estimates/:id/memos', () => {
    const post = (body: unknown, role: 'admin' | 'manager' = 'admin', url: string = MEMO_URL) =>
      request(app).post(url).set('Cookie', authCookie(role)).send(body as object);

    it('creates a memo for both roles and uses the authenticated admin as author', async () => {
      for (const role of ['admin', 'manager'] as const) {
        db.state.queries.length = 0;
        const res = await post({ content: '  Spoke with the buyer  ' }, role);

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toMatchObject({
          estimate_id: ESTIMATE_ID,
          content: 'Spoke with the buyer',
          author: {
            id: role === 'admin' ? ADMIN_ID : MANAGER_ID,
            username: role === 'admin' ? 'master' : 'staff'
          },
          created_at: '2026-10-13T05:00:00.000Z'
        });

        const insert = db.state.queries.find(q => q.sql.includes('INSERT INTO admin_memos'))!;
        expect(insert.params).toEqual([
          ESTIMATE_ID,
          role === 'admin' ? ADMIN_ID : MANAGER_ID,
          'Spoke with the buyer'
        ]);
      }
    });

    it('ignores an author supplied in the request body', async () => {
      const res = await post({ content: 'note', admin_user_id: 'attacker', author: { id: 'attacker' } });

      expect(res.status).toBe(201);
      const insert = db.state.queries.find(q => q.sql.includes('INSERT INTO admin_memos'))!;
      expect(insert.params[1]).toBe(ADMIN_ID);
      expect(JSON.stringify(res.body)).not.toContain('attacker');
    });

    it('checks the estimate and inserts in a single statement', async () => {
      await post({ content: 'note' });

      const inserts = db.state.queries.filter(q => q.sql.includes('INSERT INTO admin_memos'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0].sql).toContain('FROM estimates e WHERE e.id = $1');
    });

    it('returns 404 when the estimate does not exist', async () => {
      db.state.handler = () => undefined;
      const res = await post({ content: 'note' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ESTIMATE_NOT_FOUND');
    });

    it('returns 400 INVALID_ID for a non-UUID id', async () => {
      const res = await post({ content: 'note' }, 'admin', '/admin/estimates/BP20261013001/memos');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_ID');
    });

    it.each([
      [{}],
      [[]],
      [{ content: 123 }],
      [{ content: null }],
      [{ content: '' }],
      [{ content: '   \n\t  ' }],
      [{ content: 'bad\u0000char' }],
      [{ content: 'bell\u0007' }]
    ])('returns 400 VALIDATION_ERROR for %j', async body => {
      const res = await post(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(sqlOf(db.state).filter(s => s.includes('INSERT INTO admin_memos'))).toHaveLength(0);
    });

    it('accepts exactly 5000 characters and rejects 5001 with MEMO_TOO_LONG', async () => {
      const ok = await post({ content: 'a'.repeat(5000) });
      expect(ok.status).toBe(201);

      const tooLong = await post({ content: 'a'.repeat(5001) });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.code).toBe('MEMO_TOO_LONG');
    });

    it('counts characters, not bytes or UTF-16 units', async () => {
      const korean = await post({ content: '가'.repeat(5000) });
      expect(korean.status).toBe(201);

      const emoji = await post({ content: '😀'.repeat(5000) });
      expect(emoji.status).toBe(201);

      const emojiTooLong = await post({ content: '😀'.repeat(5001) });
      expect(emojiTooLong.body.code).toBe('MEMO_TOO_LONG');
    });

    it('trims before measuring, so padding does not count toward the limit', async () => {
      const res = await post({ content: `   ${'a'.repeat(5000)}   ` });
      expect(res.status).toBe(201);
    });

    it('allows newlines and tabs inside a memo', async () => {
      const res = await post({ content: 'line one\n\tline two\r\nline three' });
      expect(res.status).toBe(201);
    });

    it('returns 415 for non-JSON requests', async () => {
      const res = await request(app)
        .post(MEMO_URL)
        .set('Cookie', authCookie('admin'))
        .type('form')
        .send('content=hello');

      expect(res.status).toBe(415);
      expect(sqlOf(db.state).filter(s => s.includes('INSERT INTO admin_memos'))).toHaveLength(0);
    });

    it('audits the creation without the memo text', async () => {
      await post({ content: 'private negotiation details 010-9999-8888' }, 'manager');

      const records = auditRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'memo.create',
        result: 'success',
        http_status: 201,
        admin_id: MANAGER_ID,
        role: 'manager',
        estimate_id: ESTIMATE_ID,
        memo_id: 'm0000000-0000-0000-0000-000000000001'
      });

      const everything = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);
      expect(everything).not.toContain('private negotiation');
      expect(everything).not.toContain('010-9999-8888');
    });

    it('audits a missing estimate', async () => {
      db.state.handler = () => undefined;
      await post({ content: 'note' });

      expect(auditRecords()[0]).toMatchObject({ action: 'memo.create', result: 'not_found', http_status: 404 });
    });
  });

  describe('GET /admin/estimates/:id/memos', () => {
    it('lists memos newest first with the author and pagination', async () => {
      const res = await request(app).get(MEMO_URL).set('Cookie', authCookie('manager'));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          id: 'm1',
          content: 'Called the customer',
          author: { id: MANAGER_ID, username: 'staff' },
          created_at: '2026-10-13T04:00:00.000Z'
        }
      ]);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 45, total_pages: 3 });

      const list = db.state.queries.find(q => q.sql.includes('FROM admin_memos m'))!;
      expect(list.sql).toContain('ORDER BY m.created_at DESC, m.id DESC');
      expect(list.params).toEqual([ESTIMATE_ID, 20, 0]);
    });

    it('applies page and limit', async () => {
      await request(app).get(MEMO_URL).query({ page: '3', limit: '10' }).set('Cookie', authCookie('admin'));

      const list = db.state.queries.find(q => q.sql.includes('FROM admin_memos m'))!;
      expect(list.params).toEqual([ESTIMATE_ID, 10, 20]);
    });

    it.each([[{ page: '0' }], [{ limit: '101' }], [{ limit: 'abc' }]])(
      'returns 400 for invalid paging %j',
      async query => {
        const res = await request(app).get(MEMO_URL).query(query).set('Cookie', authCookie('admin'));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    );

    it('returns 400 for a non-UUID id and 404 for an unknown estimate', async () => {
      const bad = await request(app)
        .get('/admin/estimates/not-a-uuid/memos')
        .set('Cookie', authCookie('admin'));
      expect(bad.status).toBe(400);

      db.state.handler = () => undefined;
      const missing = await request(app).get(MEMO_URL).set('Cookie', authCookie('admin'));
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('ESTIMATE_NOT_FOUND');
    });

    it('audits the view without the memo text', async () => {
      await request(app).get(MEMO_URL).set('Cookie', authCookie('admin'));

      expect(auditRecords()[0]).toMatchObject({
        action: 'memo.list.view',
        result: 'success',
        admin_id: ADMIN_ID,
        estimate_id: ESTIMATE_ID
      });
      expect(JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls])).not.toContain('Called the customer');
    });
  });

  describe('memo text stays out of the estimate list', () => {
    it('never selects or returns memo content or counts from GET /admin/estimates', async () => {
      db.state.handler = sql => {
        if (sql.includes('COUNT(*)::int AS total FROM estimates')) {
          return { rows: [{ total: 1 }] };
        }
        if (sql.includes('ORDER BY')) {
          return {
            rows: [
              {
                id: ESTIMATE_ID,
                receipt_id: 'BP20261013001',
                category: 'eyewear',
                status: 'new_receipt',
                company_name: 'Acme',
                customer_name: 'Kim',
                created_at: new Date(),
                updated_at: new Date(),
                file_count: 0,
                content: 'leaked memo text'
              }
            ]
          };
        }
        return undefined;
      };

      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('leaked memo text');
      expect(Object.keys(res.body.data[0])).not.toContain('content');
      expect(sqlOf(db.state).join('\n')).not.toContain('admin_memos');
    });
  });
});

describe('parseMemoBody', () => {
  it('shares the 5000 character limit with the database constraint', () => {
    expect(MEMO_MAX_LENGTH).toBe(5000);
    expect(parseMemoBody({ content: 'x'.repeat(5000) }).valid).toBe(true);
    expect(parseMemoBody({ content: 'x'.repeat(5001) }).valid).toBe(false);
  });
});
