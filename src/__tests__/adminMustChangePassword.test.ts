jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { allowPasswordChangeRequired, authMiddleware } from '../middleware/auth';
import {
  ADMIN_ID,
  ESTIMATE_ID,
  MANAGER_ID,
  authCookie,
  createFakeDb,
  sqlOf
} from './helpers/adminTestUtils';

const FILE_ID = 'f0000000-0000-0000-0000-000000000001';
const BASE = `/admin/estimates/${ESTIMATE_ID}`;
const INITIAL = 'One-Time-Passw0rd!';
const NEW = 'Brand-New-Passw0rd!';

// Every admin route except the password change and logout.
const BLOCKED_ROUTES: Array<{ name: string; call: (app: Express, cookie: string) => request.Test }> = [
  { name: 'GET list', call: (app, cookie) => request(app).get('/admin/estimates').set('Cookie', cookie) },
  { name: 'GET detail', call: (app, cookie) => request(app).get(BASE).set('Cookie', cookie) },
  {
    name: 'PATCH status',
    call: (app, cookie) => request(app).patch(`${BASE}/status`).set('Cookie', cookie).send({ to_status: 'under_review' })
  },
  { name: 'GET memos', call: (app, cookie) => request(app).get(`${BASE}/memos`).set('Cookie', cookie) },
  {
    name: 'POST memo',
    call: (app, cookie) => request(app).post(`${BASE}/memos`).set('Cookie', cookie).send({ content: 'note' })
  },
  { name: 'GET files', call: (app, cookie) => request(app).get(`${BASE}/files`).set('Cookie', cookie) },
  {
    name: 'GET file download',
    call: (app, cookie) => request(app).get(`${BASE}/files/${FILE_ID}/download`).set('Cookie', cookie)
  }
];

describe('must_change_password enforcement (mocked database)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let row: Record<string, unknown>;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const initialHash = bcrypt.hashSync(INITIAL, 4);

  const auditRecords = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  const touchedBusinessTables = () =>
    sqlOf(db.state).filter(sql => /FROM estimates|admin_memos|FROM files|INTO status_history/.test(sql));

  const loginCookie = (res: request.Response): string =>
    (res.headers['set-cookie'] as unknown as string[])
      .find(c => c.startsWith('access_token='))!
      .split(';')[0];

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);

    // An account in the state migration 011 gives the seeded master: flagged for a change.
    row = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: initialHash,
      role: 'admin',
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
      must_change_password: true
    };
    db.state.mustChangePassword = true;

    db.state.handler = (sql, params) => {
      if (sql.includes('password_hash') && sql.includes('WHERE username')) {
        return { rows: [{ ...row }] };
      }
      if (sql.includes('FROM admin_users WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ ...row, id: params[0] }] };
      }
      if (sql.includes('SET password_hash')) {
        row.password_hash = params[1];
        row.failed_login_attempts = 0;
        row.locked_until = null;
        if (/must_change_password = false/.test(sql)) {
          row.must_change_password = false;
          db.state.mustChangePassword = false;
        }
        return { rows: [] };
      }
      if (sql.includes('SET failed_login_attempts = $1')) {
        row.failed_login_attempts = params[0];
        row.locked_until = params[1];
        return { rows: [] };
      }
      if (/SET failed_login_attempts = 0, locked_until = null/i.test(sql)) {
        row.failed_login_attempts = 0;
        row.locked_until = null;
        return { rows: [] };
      }
      if (sql.includes('UPDATE admin_sessions SET is_revoked = true')) {
        db.state.sessionRevoked = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('COUNT(*)::int AS total FROM estimates')) {
        return { rows: [{ total: 0 }] };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('after the first login of a flagged account', () => {
    it('login succeeds and tells the client that a password change is required', async () => {
      const res = await request(app).post('/admin/login').send({ username: 'master', password: INITIAL });

      expect(res.status).toBe(200);
      expect(res.body.admin).toEqual({
        id: ADMIN_ID,
        username: 'master',
        email: 'admin@bridgepath.local',
        role: 'admin',
        must_change_password: true
      });
    });

    it.each(BLOCKED_ROUTES.map(r => [r.name, r] as const))(
      'blocks %s with 403 PASSWORD_CHANGE_REQUIRED',
      async (_name, route) => {
        const login = await request(app).post('/admin/login').send({ username: 'master', password: INITIAL });
        const res = await route.call(app, loginCookie(login));

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
        expect(res.body.error).toMatch(/change your password/);
        expect(touchedBusinessTables()).toHaveLength(0);
      }
    );

    it('blocks the manager role in the same way', async () => {
      for (const route of BLOCKED_ROUTES) {
        const res = await route.call(app, authCookie('manager'));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      expect(touchedBusinessTables()).toHaveLength(0);
    });

    it('audits blocked requests without personal data or request details', async () => {
      await request(app).get('/admin/estimates/' + ESTIMATE_ID).set('Cookie', authCookie('admin'));

      const records = auditRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'admin.access.blocked',
        result: 'denied',
        http_status: 403,
        error_code: 'PASSWORD_CHANGE_REQUIRED',
        admin_id: ADMIN_ID,
        role: 'admin'
      });
      expect(Object.keys(records[0]).sort()).toEqual(
        ['action', 'admin_id', 'error_code', 'http_status', 'ip', 'result', 'role'].sort()
      );
    });

    it('still lets the account reach the password change endpoint', async () => {
      const emptyBody = await request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({});
      expect(emptyBody.status).toBe(400);
      expect(emptyBody.body.code).toBe('VALIDATION_ERROR');

      const wrongCurrent = await request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({ current_password: 'not-the-password', new_password: NEW });
      expect(wrongCurrent.status).toBe(401);
      expect(wrongCurrent.body.code).toBe('INVALID_CURRENT_PASSWORD');
    });

    it('still lets the account log out', async () => {
      const res = await request(app).post('/admin/logout').set('Cookie', authCookie('admin'));

      expect(res.status).toBe(200);
      expect(sqlOf(db.state).some(sql => sql.includes('is_revoked = true'))).toBe(true);
    });

    it('does not accept the seeded default password as the new password', async () => {
      const res = await request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({ current_password: INITIAL, new_password: 'CHANGE_ME_ON_FIRST_LOGIN' });

      expect(res.status).toBe(400);
      expect(res.body.details.violations).toContain('MATCHES_DEFAULT_PASSWORD');
      expect(row.must_change_password).toBe(true);
    });

    it('a wrong password change attempt keeps the flag and the sessions', async () => {
      await request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({ current_password: 'not-the-password', new_password: NEW });

      expect(row.must_change_password).toBe(true);
      expect(db.state.sessionRevoked).toBe(false);
    });
  });

  describe('changing the password clears the requirement', () => {
    it('sets must_change_password = false in the same update as the new hash', async () => {
      const res = await request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({ current_password: INITIAL, new_password: NEW });

      expect(res.status).toBe(200);
      expect(row.must_change_password).toBe(false);

      const update = db.state.queries.find(q => q.sql.includes('SET password_hash'))!;
      expect(update.sql.replace(/\s+/g, ' ')).toContain('must_change_password = false');

      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements[0]).toBe('BEGIN');
      expect(statements[statements.length - 1]).toBe('COMMIT');
    });

    it('completes the whole flow: blocked -> change -> old session dead -> login -> API works', async () => {
      const firstLogin = await request(app).post('/admin/login').send({ username: 'master', password: INITIAL });
      expect(firstLogin.body.admin.must_change_password).toBe(true);
      const firstCookie = loginCookie(firstLogin);

      // 1. general API is blocked
      expect((await request(app).get('/admin/estimates').set('Cookie', firstCookie)).status).toBe(403);

      // 2. the password change works and ends every session
      const changed = await request(app)
        .patch('/admin/me/password')
        .set('Cookie', firstCookie)
        .send({ current_password: INITIAL, new_password: NEW });
      expect(changed.status).toBe(200);
      expect(changed.body.data.reauthentication_required).toBe(true);
      expect(row.must_change_password).toBe(false);

      // 3. the old session is revoked
      expect((await request(app).get('/admin/estimates').set('Cookie', firstCookie)).status).toBe(401);

      // 4. the old password no longer works; the new one does and carries no flag
      db.state.sessionRevoked = false;
      expect((await request(app).post('/admin/login').send({ username: 'master', password: INITIAL })).status).toBe(401);

      const secondLogin = await request(app).post('/admin/login').send({ username: 'master', password: NEW });
      expect(secondLogin.status).toBe(200);
      expect(secondLogin.body.admin.must_change_password).toBe(false);
      const secondCookie = loginCookie(secondLogin);

      // 5. the whole admin API is reachable now
      const list = await request(app).get('/admin/estimates').set('Cookie', secondCookie);
      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);

      const detail = await request(app).get(BASE).set('Cookie', secondCookie);
      expect(detail.status).toBe(404); // reaches the handler: the estimate simply does not exist
      expect((await request(app).get(`${BASE}/memos`).set('Cookie', secondCookie)).status).toBe(404);
      expect((await request(app).get(`${BASE}/files`).set('Cookie', secondCookie)).status).toBe(404);
    });
  });

  describe('accounts that are not flagged (regression)', () => {
    beforeEach(() => {
      row.must_change_password = false;
      db.state.mustChangePassword = false;
    });

    it('log in with must_change_password = false and use every admin route', async () => {
      const login = await request(app).post('/admin/login').send({ username: 'master', password: INITIAL });
      expect(login.status).toBe(200);
      expect(login.body.admin.must_change_password).toBe(false);

      const cookie = loginCookie(login);
      for (const route of BLOCKED_ROUTES) {
        const res = await route.call(app, cookie);
        expect(res.status).not.toBe(403);
        expect(res.body.code).not.toBe('PASSWORD_CHANGE_REQUIRED');
      }
      expect((await request(app).get('/admin/estimates').set('Cookie', cookie)).status).toBe(200);
    });

    it('managers are unaffected too', async () => {
      const res = await request(app).get('/admin/estimates').set('Cookie', authCookie('manager'));
      expect(res.status).toBe(200);
      expect(MANAGER_ID).toBeDefined();
    });

    it('raising the flag on an open session blocks the next request', async () => {
      const cookie = authCookie('admin');
      expect((await request(app).get('/admin/estimates').set('Cookie', cookie)).status).toBe(200);

      db.state.mustChangePassword = true;

      const blocked = await request(app).get('/admin/estimates').set('Cookie', cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('logging in does not require the flag to be present in older rows (missing = not required)', async () => {
      delete row.must_change_password;

      const login = await request(app).post('/admin/login').send({ username: 'master', password: INITIAL });
      expect(login.status).toBe(200);
      expect(login.body.admin.must_change_password).toBe(false);
    });
  });

  describe('deny by default', () => {
    it('a route using only authMiddleware is blocked for a flagged account; an opted-in route is not', async () => {
      const cookieParser = (await import('cookie-parser')).default;
      const mini = express();
      mini.use(cookieParser());
      mini.get('/protected', authMiddleware, (_req, res) => {
        res.json({ reached: true });
      });
      mini.get('/opted-in', allowPasswordChangeRequired, authMiddleware, (_req, res) => {
        res.json({ reached: true });
      });

      const blocked = await request(mini).get('/protected').set('Cookie', authCookie('admin'));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const allowed = await request(mini).get('/opted-in').set('Cookie', authCookie('admin'));
      expect(allowed.status).toBe(200);
      expect(allowed.body).toEqual({ reached: true });

    });

    it('only the password change and logout opt in', () => {
      const fs = jest.requireActual('fs') as typeof import('fs');
      const path = jest.requireActual('path') as typeof import('path');
      const routesDir = path.join(__dirname, '..', 'routes');

      const optedIn = fs
        .readdirSync(routesDir)
        .filter(file => file.endsWith('.ts'))
        .filter(file => fs.readFileSync(path.join(routesDir, file), 'utf8').includes('allowPasswordChangeRequired,'))
        .sort();

      expect(optedIn).toEqual(['adminAccount.ts', 'adminAuth.ts']);
    });
  });
});
