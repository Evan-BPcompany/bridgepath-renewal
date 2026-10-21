jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { allowedTransitions, ESTIMATE_STATUSES, STATUS_TRANSITIONS } from '../utils/statusTransitions';
import { ESTIMATE_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

// What the admin screen (admin-ui/) needs from the backend besides the API that already existed:
// the next statuses an admin may choose, who is signed in, and the static files themselves.

describe('allowedTransitions', () => {
  it('lists, for an admin, every transition from the status with its reason rule', () => {
    expect(allowedTransitions('new_receipt', 'admin')).toEqual([
      { to: 'under_review', reason_required: false },
      { to: 'cancelled', reason_required: true }
    ]);
  });

  it('leaves out what a manager may not do (cancelling)', () => {
    expect(allowedTransitions('new_receipt', 'manager')).toEqual([{ to: 'under_review', reason_required: false }]);
    expect(allowedTransitions('accepted', 'manager')).toEqual([
      { to: 'completed', reason_required: true },
      { to: 'on_hold', reason_required: true }
    ]);
  });

  it('is exactly the table of transitions, for every status and both roles', () => {
    for (const status of ESTIMATE_STATUSES) {
      const rows = STATUS_TRANSITIONS.filter(transition => transition.from === status);

      expect(allowedTransitions(status, 'admin').map(item => item.to)).toEqual(rows.map(row => row.to));
      expect(allowedTransitions(status, 'manager').map(item => item.to)).toEqual(
        rows.filter(row => row.managerAllowed).map(row => row.to)
      );
    }
  });

  it('has no way on from the end of the line, from a retired status or from nonsense', () => {
    expect(allowedTransitions('completed', 'admin')).toEqual([]);
    expect(allowedTransitions('cancelled', 'admin')).toEqual([]);
    expect(allowedTransitions('rejected', 'admin')).toEqual([]);
    expect(allowedTransitions('', 'admin')).toEqual([]);
    expect(allowedTransitions('__proto__', 'admin')).toEqual([]);
  });
});

describe('the admin screen and its two backend additions (mocked database)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;

  const estimateRow = (status: string) => ({
    id: ESTIMATE_ID,
    receipt_id: 'BP20261021001',
    category: 'eyewear',
    status,
    customer_name: 'Kim',
    customer_email: 'buyer@example.com',
    customer_phone: null,
    company_name: 'Acme',
    customer_type: 'business_brand',
    privacy_consent_at: new Date('2026-10-21T01:00:00Z'),
    privacy_consent_version: 'dev-draft',
    specification_json: { quantity: 500 },
    is_consultation: false,
    created_at: new Date('2026-10-21T01:00:00Z'),
    updated_at: new Date('2026-10-21T01:00:00Z')
  });

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /admin/estimates/:id', () => {
    const detail = (role: 'admin' | 'manager', status: string) => {
      db.state.handler = sql => (sql.includes('FROM estimates WHERE id = $1') ? { rows: [estimateRow(status)] } : undefined);
      return request(app).get(`/admin/estimates/${ESTIMATE_ID}`).set('Cookie', authCookie(role));
    };

    it('says what this admin may do next', async () => {
      const res = await detail('admin', 'quoted');

      expect(res.status).toBe(200);
      expect(res.body.data.allowed_transitions).toEqual([
        { to: 'customer_review', reason_required: false },
        { to: 'accepted', reason_required: false },
        { to: 'on_hold', reason_required: true },
        { to: 'cancelled', reason_required: true }
      ]);
    });

    it('gives a manager a shorter list, for the same estimate', async () => {
      const res = await detail('manager', 'quoted');

      expect(res.body.data.allowed_transitions.map((item: { to: string }) => item.to)).toEqual([
        'customer_review',
        'accepted',
        'on_hold'
      ]);
    });

    it('gives an empty list for a retired status, and keeps the rest of the detail', async () => {
      const res = await detail('admin', 'rejected');

      expect(res.body.data.allowed_transitions).toEqual([]);
      expect(res.body.data.estimate.receipt_id).toBe('BP20261021001');
      expect(res.body.data.files).toEqual([]);
    });
  });

  describe('GET /admin/me', () => {
    it('needs a session', async () => {
      const res = await request(app).get('/admin/me');

      expect(res.status).toBe(401);
    });

    it('says who is signed in and with which role, and nothing else', async () => {
      const res = await request(app).get('/admin/me').set('Cookie', authCookie('manager'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          id: expect.any(String),
          username: 'staff',
          email: 'staff@bridgepath.local',
          role: 'manager',
          must_change_password: false
        }
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash|token|session/i);
    });

    it('answers an account that must change its password, so the screen can send it to the right form', async () => {
      db.state.mustChangePassword = true;

      const res = await request(app).get('/admin/me').set('Cookie', authCookie('admin'));

      expect(res.status).toBe(200);
      expect(res.body.data.must_change_password).toBe(true);
    });

    it('is not answered for a revoked session', async () => {
      db.state.sessionRevoked = true;

      const res = await request(app).get('/admin/me').set('Cookie', authCookie('admin'));

      expect(res.status).toBe(401);
    });

    it('does not take away the password change that lives at the same address', async () => {
      const res = await request(app).patch('/admin/me/password').send({});

      expect(res.status).toBe(401);
    });
  });

  describe('/admin-ui/ (the static files of the screen)', () => {
    it('serves the page without a session and without touching the database', async () => {
      const res = await request(app).get('/admin-ui/');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(db.pool.query).not.toHaveBeenCalled();
    });

    it('serves the same page at /admin-ui/index.html, and redirects /admin-ui to the folder', async () => {
      expect((await request(app).get('/admin-ui/index.html')).status).toBe(200);
      expect((await request(app).get('/admin-ui')).status).toBe(301);
    });

    it('must not be cached or indexed', async () => {
      const res = await request(app).get('/admin-ui/');

      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });

    it('keeps the security headers of helmet: scripts only from the same origin, no framing', async () => {
      const res = await request(app).get('/admin-ui/');
      const csp = String(res.headers['content-security-policy']);

      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
      expect(csp).toContain("frame-ancestors 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it.each([
      ['a file that is not there', '/admin-ui/missing.js'],
      ['a path out of the folder', '/admin-ui/%2e%2e/package.json'],
      ['a path out of the folder, encoded twice', '/admin-ui/%252e%252e/package.json'],
      ['a hidden file', '/admin-ui/.env'],
      ['the source of the server', '/admin-ui/../src/app.ts']
    ])('does not serve %s', async (_name, url) => {
      const res = await request(app).get(url);

      expect(res.status).not.toBe(200);
      expect(res.text).not.toMatch(/JWT_SECRET|express\(\)|"name": "bridge-path-mvp"/);
    });
  });
});
