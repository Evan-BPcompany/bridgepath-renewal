jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { hashRefreshToken } from '../utils/token';
import { createApp } from '../app';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import {
  MASTER_ID,
  MASTER_USERNAME,
  NEW_PASSWORD,
  PASSWORD,
  WRONG_PASSWORD,
  cookieValueOf,
  createTestApp,
  insertAdmin,
  login,
  passwordHash,
  resetData
} from './helpers/fixtures';

// Login, lockout, sessions, refresh and logout against the real tables. Passwords are
// hashed with a low bcrypt cost by the fixtures; the application code is unchanged.
describeIntegration('admin authentication on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;

  const sessions = (adminId = MASTER_ID) =>
    suite().db('admin_sessions').where({ admin_user_id: adminId }).orderBy('created_at');
  const master = () => suite().db('admin_users').where({ id: MASTER_ID }).first();
  const doLogin = (username: string, password: string) =>
    request(app).post('/admin/login').send({ username, password });
  const listEstimates = (cookie: string) => request(app).get('/admin/estimates').set('Cookie', cookie);

  beforeEach(async () => {
    await resetData(suite().db);
    app = createTestApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login', () => {
    it('creates a session row with the hash of the refresh token, never the token itself', async () => {
      const res = await doLogin(MASTER_USERNAME, PASSWORD);

      expect(res.status).toBe(200);
      expect(res.body.admin).toMatchObject({ id: MASTER_ID, username: MASTER_USERNAME, role: 'admin' });

      const rows = await sessions();
      expect(rows).toHaveLength(1);
      expect(rows[0].is_revoked).toBe(false);
      expect(rows[0].refresh_token_hash).toBe(hashRefreshToken(cookieValueOf(res, 'refresh_token')!));
      expect(rows[0].refresh_token_hash).not.toBe(cookieValueOf(res, 'refresh_token'));
      const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThanOrEqual(30);
    });

    it('also works with the e-mail address instead of the user name', async () => {
      const res = await request(app).post('/admin/login').send({ email: 'admin@bridgepath.local', password: PASSWORD });

      expect(res.status).toBe(200);
    });

    it('rejects a wrong password and an unknown user the same way, without a session', async () => {
      const wrong = await doLogin(MASTER_USERNAME, WRONG_PASSWORD);
      const unknown = await doLogin('nobody', PASSWORD);

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toBe(unknown.body.error);
      expect(await sessions()).toHaveLength(0);
    });

    it('rejects an inactive account', async () => {
      await insertAdmin(suite().db, { username: 'inactive', active: false });

      const res = await doLogin('inactive', PASSWORD);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Admin account is inactive');
    });

    it('returns must_change_password for the flagged account', async () => {
      await insertAdmin(suite().db, { username: 'flagged', mustChangePassword: true });

      const res = await doLogin('flagged', PASSWORD);

      expect(res.status).toBe(200);
      expect(res.body.admin.must_change_password).toBe(true);
    });
  });

  describe('lockout (5 failures / 15 minutes) is stored in the database', () => {
    it('counts failures, locks on the fifth and refuses the right password while locked', async () => {
      for (let expected = 1; expected <= 4; expected += 1) {
        expect((await doLogin(MASTER_USERNAME, WRONG_PASSWORD)).status).toBe(401);
        const row = await master();
        expect(row.failed_login_attempts).toBe(expected);
        expect(row.locked_until).toBeNull();
      }

      await doLogin(MASTER_USERNAME, WRONG_PASSWORD);
      const locked = await master();
      expect(locked.failed_login_attempts).toBe(5);
      const minutes = (new Date(locked.locked_until).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      const refused = await doLogin(MASTER_USERNAME, PASSWORD);
      expect(refused.status).toBe(401);
      expect(refused.body.error).toBe('Account is locked. Try again later.');
      expect(await sessions()).toHaveLength(0);
    });

    it('a successful login clears the counter', async () => {
      await doLogin(MASTER_USERNAME, WRONG_PASSWORD);
      await doLogin(MASTER_USERNAME, WRONG_PASSWORD);
      expect((await master()).failed_login_attempts).toBe(2);

      expect((await doLogin(MASTER_USERNAME, PASSWORD)).status).toBe(200);
      expect((await master()).failed_login_attempts).toBe(0);
    });

    it('after the lock has expired the counter starts from zero again', async () => {
      await suite().db('admin_users').where({ id: MASTER_ID }).update({
        failed_login_attempts: 5,
        locked_until: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 minute'")
      });

      await doLogin(MASTER_USERNAME, WRONG_PASSWORD);

      const row = await master();
      expect(row.failed_login_attempts).toBe(1);
      expect(row.locked_until).toBeNull();
    });

    it('4 parallel wrong passwords are counted exactly 4 times', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => doLogin(MASTER_USERNAME, WRONG_PASSWORD)));

      expect(results.map(r => r.status)).toEqual([401, 401, 401, 401]);
      const row = await master();
      expect(row.failed_login_attempts).toBe(4);
      expect(row.locked_until).toBeNull();
    });

    it('6 parallel wrong passwords lock the account, and the right password is then refused', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => doLogin(MASTER_USERNAME, WRONG_PASSWORD)));

      expect(results.map(r => r.status)).toEqual(Array(6).fill(401));
      const row = await master();
      // The counter stops at the limit: late failures neither raise it nor extend the lock.
      expect(row.failed_login_attempts).toBe(5);
      const minutes = (new Date(row.locked_until).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      const right = await doLogin(MASTER_USERNAME, PASSWORD);
      expect(right.status).toBe(401);
      expect(right.body.error).toBe('Account is locked. Try again later.');
      expect(await sessions()).toHaveLength(0);
    });

    it('3 parallel failures after a lock has expired count from zero: exactly 3, no lock', async () => {
      await suite().db('admin_users').where({ id: MASTER_ID }).update({
        failed_login_attempts: 5,
        locked_until: new Date(Date.now() - 60_000)
      });

      await Promise.all(Array.from({ length: 3 }, () => doLogin(MASTER_USERNAME, WRONG_PASSWORD)));

      const row = await master();
      expect(row.failed_login_attempts).toBe(3);
      expect(row.locked_until).toBeNull();
    });

    it('requests refused with 429 are not counted as failed logins', async () => {
      const limited = createApp({
        rateLimits: {
          login: { windowMs: 60_000, max: 2 },
          api: { windowMs: 60_000, max: 100_000 },
          mutation: { windowMs: 60_000, max: 100_000 },
          password: { windowMs: 60_000, max: 100_000 }
        }
      });

      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await request(limited).post('/admin/login').send({ username: MASTER_USERNAME, password: WRONG_PASSWORD })).status);
      }

      const refusedByPassword = statuses.filter(status => status === 401).length;
      expect(statuses).toContain(429);
      expect(refusedByPassword).toBeLessThan(6);
      expect((await master()).failed_login_attempts).toBe(refusedByPassword);
    });
  });

  describe('sessions guard the API', () => {
    it('a logged-in admin can call the API, a request without cookies cannot', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      expect((await listEstimates(session.cookie)).status).toBe(200);
      expect((await request(app).get('/admin/estimates')).status).toBe(401);
    });

    it('a revoked session stops working immediately', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await suite().db('admin_sessions').update({ is_revoked: true });

      const res = await listEstimates(session.cookie);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has been revoked');
    });

    it('an expired session stops working', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await suite().db('admin_sessions').update({
        expires_at: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'")
      });

      const res = await listEstimates(session.cookie);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has expired');
    });

    it('a deactivated admin is locked out even with a valid session', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await suite().db('admin_users').where({ id: MASTER_ID }).update({ is_active: false });

      const res = await listEstimates(session.cookie);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Admin account is inactive');
    });

    it('a flagged account may only change its password or log out', async () => {
      await insertAdmin(suite().db, { username: 'flagged', mustChangePassword: true });
      const session = await login(app, 'flagged', PASSWORD);

      const blocked = await listEstimates(session.cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      expect((await request(app).post('/admin/logout').set('Cookie', session.cookie)).status).toBe(200);
    });
  });

  describe('refresh', () => {
    const refresh = (refreshToken: string, extraCookie = '') =>
      request(app)
        .post('/admin/token/refresh')
        .set('Cookie', `${extraCookie}${extraCookie ? '; ' : ''}refresh_token=${refreshToken}`);

    it('works with only the refresh token, and the old token stops working', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const res = await refresh(session.refreshToken);

      expect(res.status).toBe(200);
      const newRefresh = cookieValueOf(res, 'refresh_token')!;
      expect(newRefresh).not.toBe(session.refreshToken);

      const rows = await sessions();
      expect(rows).toHaveLength(1);
      expect(rows[0].refresh_token_hash).toBe(hashRefreshToken(newRefresh));

      expect((await refresh(session.refreshToken)).status).toBe(401);
      expect((await refresh(newRefresh)).status).toBe(200);
    });

    it('works when the access token has already expired, and the new access token works', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const expiredAccess = jwt.sign(
        { adminUserId: MASTER_ID, sessionId: (await sessions())[0].id, role: 'admin' },
        config.jwtSecret,
        { algorithm: 'HS256', expiresIn: -60 }
      );
      expect((await listEstimates(`access_token=${expiredAccess}`)).status).toBe(401);

      const res = await refresh(session.refreshToken, `access_token=${expiredAccess}`);

      expect(res.status).toBe(200);
      const fresh = `access_token=${cookieValueOf(res, 'access_token')}`;
      expect((await listEstimates(fresh)).status).toBe(200);
    });

    it('two parallel refreshes with the same token: exactly one wins', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const results = await Promise.all([refresh(session.refreshToken), refresh(session.refreshToken)]);

      expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    });

    it('refuses a token that belongs to no session, a malformed one and a missing one', async () => {
      expect((await refresh('a'.repeat(64))).status).toBe(401);
      expect((await refresh('not-hex')).status).toBe(401);
      expect((await request(app).post('/admin/token/refresh')).status).toBe(401);
    });

    it('refuses a revoked session, an expired session and an inactive admin', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      await suite().db('admin_sessions').update({ is_revoked: true });
      expect((await refresh(session.refreshToken)).body.error).toBe('Session has been revoked');
      await suite().db('admin_sessions').update({ is_revoked: false, expires_at: suite().db.raw("CURRENT_TIMESTAMP - INTERVAL '1 second'") });
      expect((await refresh(session.refreshToken)).body.error).toBe('Session has expired');
      await suite().db('admin_sessions').update({ expires_at: suite().db.raw("CURRENT_TIMESTAMP + INTERVAL '1 day'") });
      await suite().db('admin_users').where({ id: MASTER_ID }).update({ is_active: false });
      expect((await refresh(session.refreshToken)).body.error).toBe('Admin account is inactive');
    });

    it('keeps the role of the database: a demoted admin gets a manager token', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await suite().db('admin_users').where({ id: MASTER_ID }).update({ role: 'manager' });

      const res = await refresh(session.refreshToken);

      const token = cookieValueOf(res, 'access_token')!;
      const payload = jwt.decode(token) as { role: string };
      expect(payload.role).toBe('manager');
    });
  });

  describe('refresh at the same time as a change of the account', () => {
    const refresh = (refreshToken: string) =>
      request(app).post('/admin/token/refresh').set('Cookie', `refresh_token=${refreshToken}`);
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const refreshHash = async () => (await sessions())[0].refresh_token_hash as string;

    // Starts a request and reports whether it has answered yet.
    const track = <T>(promise: Promise<T>) => {
      const state = { done: false };
      const result = promise.then(value => {
        state.done = true;
        return value;
      });
      return { state, result };
    };

    it('a deactivation that is not committed yet holds the refresh back; once committed the refresh is refused', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const hashBefore = await refreshHash();

      // The deactivation is in flight: the refresh below still reads an active account
      // (uncommitted changes are invisible) and so passes the checks made before the lock.
      const deactivation = await suite().db.transaction();
      await deactivation('admin_users').where({ id: MASTER_ID }).update({ is_active: false });

      const pending = track(refresh(session.refreshToken).then(res => res));
      await sleep(400);
      // Waiting for the lock; without the lock it would have rotated the token by now.
      expect(pending.state.done).toBe(false);

      await deactivation.commit();
      const res = await pending.result;

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Admin account is inactive');
      expect(cookieValueOf(res, 'access_token')).toBeUndefined();
      expect(cookieValueOf(res, 'refresh_token')).toBeUndefined();
      expect(await refreshHash()).toBe(hashBefore);
    });

    it('a deactivation that is rolled back lets the waiting refresh succeed', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const deactivation = await suite().db.transaction();
      // A transaction opened without a callback rejects its execution promise when rolled back.
      deactivation.executionPromise.catch(() => undefined);
      await deactivation('admin_users').where({ id: MASTER_ID }).update({ is_active: false });

      const pending = track(refresh(session.refreshToken).then(res => res));
      await sleep(400);
      expect(pending.state.done).toBe(false);

      await deactivation.rollback();
      const res = await pending.result;

      expect(res.status).toBe(200);
      expect((await listEstimates(`access_token=${cookieValueOf(res, 'access_token')}`)).status).toBe(200);
    });

    it('a role change that is committed while the refresh waits ends up in the new access token', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const change = await suite().db.transaction();
      await change('admin_users').where({ id: MASTER_ID }).update({ role: 'manager' });

      const pending = track(refresh(session.refreshToken).then(res => res));
      await sleep(400);
      expect(pending.state.done).toBe(false);

      await change.commit();
      const res = await pending.result;

      expect(res.status).toBe(200);
      expect((jwt.decode(cookieValueOf(res, 'access_token')!) as { role: string }).role).toBe('manager');
    });

    it('a session revoked while the refresh waits for the lock is not rotated', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const hashBefore = await refreshHash();

      // What a password change does: lock the user row, then revoke the sessions.
      const passwordChange = await suite().db.transaction();
      await passwordChange.raw('SELECT id FROM admin_users WHERE id = ? FOR UPDATE', [MASTER_ID]);
      await passwordChange('admin_sessions').where({ admin_user_id: MASTER_ID }).update({ is_revoked: true });

      const pending = track(refresh(session.refreshToken).then(res => res));
      await sleep(400);
      expect(pending.state.done).toBe(false);

      await passwordChange.commit();
      const res = await pending.result;

      expect(res.status).toBe(401);
      expect(cookieValueOf(res, 'access_token')).toBeUndefined();
      expect(await refreshHash()).toBe(hashBefore);
      expect((await sessions())[0].is_revoked).toBe(true);
    });

    it('5 parallel refreshes with the same token: exactly one wins and its token is the stored one', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const results = await Promise.all(Array.from({ length: 5 }, () => refresh(session.refreshToken)));

      const winners = results.filter(r => r.status === 200);
      expect(winners).toHaveLength(1);
      expect(results.filter(r => r.status === 401)).toHaveLength(4);
      expect(await refreshHash()).toBe(hashRefreshToken(cookieValueOf(winners[0], 'refresh_token')!));
    });

    it('parallel refreshes of different sessions of the same admin do not wait for or fail each other', async () => {
      const sessionsOfAdmin = await Promise.all(Array.from({ length: 4 }, () => login(app, MASTER_USERNAME, PASSWORD)));

      const results = await Promise.all(sessionsOfAdmin.map(session => refresh(session.refreshToken)));

      expect(results.map(r => r.status)).toEqual([200, 200, 200, 200]);
    });

    it('refresh, password change and login together: no error, no deadlock, no usable session left (repeated)', async () => {
      for (let round = 1; round <= 10; round += 1) {
        await suite().db('admin_sessions').del();
        await suite().db('admin_users').where({ id: MASTER_ID }).update({ password_hash: passwordHash(PASSWORD) });
        const mine = await login(app, MASTER_USERNAME, PASSWORD);
        const other = await login(app, MASTER_USERNAME, PASSWORD);

        const [refreshed, changed, loggedIn] = await Promise.all([
          refresh(other.refreshToken),
          request(app)
            .patch('/admin/me/password')
            .set('Cookie', mine.cookie)
            .send({ current_password: PASSWORD, new_password: NEW_PASSWORD }),
          request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: PASSWORD })
        ]);

        // Never a 500 (a deadlock would surface as one).
        expect([refreshed.status, changed.status, loggedIn.status].filter(status => status >= 500)).toEqual([]);
        expect(changed.status).toBe(200);
        expect([200, 401]).toContain(refreshed.status);
        expect([200, 401]).toContain(loggedIn.status);

        // The change revoked everything, whichever request came first.
        const open = (await sessions()).filter(row => !row.is_revoked);
        expect(open).toHaveLength(0);
        if (refreshed.status === 200) {
          const fresh = `access_token=${cookieValueOf(refreshed, 'access_token')}`;
          expect((await listEstimates(fresh)).status).toBe(401);
        }
      }
    });
  });

  describe('logout', () => {
    it('revokes only the session that logged out', async () => {
      const first = await login(app, MASTER_USERNAME, PASSWORD);
      const second = await login(app, MASTER_USERNAME, PASSWORD);

      expect((await request(app).post('/admin/logout').set('Cookie', first.cookie)).status).toBe(200);

      const rows = await sessions();
      expect(rows.map(r => r.is_revoked)).toEqual([true, false]);
      expect((await listEstimates(first.cookie)).status).toBe(401);
      expect((await listEstimates(second.cookie)).status).toBe(200);
    });

    it('the refresh token of a logged-out session no longer refreshes', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await request(app).post('/admin/logout').set('Cookie', session.cookie);

      const res = await request(app).post('/admin/token/refresh').set('Cookie', `refresh_token=${session.refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has been revoked');
    });
  });
});
