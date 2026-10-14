jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import {
  MASTER_ID,
  MASTER_USERNAME,
  NEW_PASSWORD,
  PASSWORD,
  WRONG_PASSWORD,
  createTestApp,
  insertAdmin,
  login,
  passwordHash,
  resetData
} from './helpers/fixtures';

// Changing the own password on a real PostgreSQL: the new hash, the forced-change flag, the
// revocation of every session of that admin (and only that admin), the shared lockout counter
// and the row lock that serializes parallel changes.
describeIntegration('password change on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;
  let otherId: string;

  const change = (cookie: string, current: string, next: string) =>
    request(app).patch('/admin/me/password').set('Cookie', cookie).send({ current_password: current, new_password: next });
  const account = (id = MASTER_ID) => suite().db('admin_users').where({ id }).first();
  const sessionStates = async (adminId: string) =>
    (await suite().db('admin_sessions').where({ admin_user_id: adminId }).orderBy('created_at')).map(
      (row: { is_revoked: boolean }) => row.is_revoked
    );

  beforeEach(async () => {
    await resetData(suite().db);
    otherId = await insertAdmin(suite().db, { username: 'colleague', role: 'manager' });
    app = createTestApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a successful change', () => {
    it('stores a new bcrypt hash, resets the counters and clears the forced-change flag', async () => {
      await suite().db('admin_users').where({ id: MASTER_ID }).update({
        must_change_password: true,
        failed_login_attempts: 3
      });
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const before = await account();

      const res = await change(session.cookie, PASSWORD, NEW_PASSWORD);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ reauthentication_required: true });
      const after = await account();
      expect(after.password_hash).not.toBe(before.password_hash);
      expect(await bcrypt.compare(NEW_PASSWORD, after.password_hash)).toBe(true);
      expect(await bcrypt.compare(PASSWORD, after.password_hash)).toBe(false);
      expect(after).toMatchObject({ must_change_password: false, failed_login_attempts: 0, locked_until: null });
      expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
    });

    it('an account that must change its password can do it, and works normally afterwards', async () => {
      await insertAdmin(suite().db, { username: 'flagged', mustChangePassword: true });
      const flagged = await login(app, 'flagged', PASSWORD);
      expect((await request(app).get('/admin/estimates').set('Cookie', flagged.cookie)).status).toBe(403);

      expect((await change(flagged.cookie, PASSWORD, NEW_PASSWORD)).status).toBe(200);

      const again = await login(app, 'flagged', NEW_PASSWORD);
      expect((await request(app).get('/admin/estimates').set('Cookie', again.cookie)).status).toBe(200);
    });

    it('revokes every session of that admin, including the current one', async () => {
      const first = await login(app, MASTER_USERNAME, PASSWORD);
      const second = await login(app, MASTER_USERNAME, PASSWORD);

      await change(first.cookie, PASSWORD, NEW_PASSWORD);

      expect(await sessionStates(MASTER_ID)).toEqual([true, true]);
      expect((await request(app).get('/admin/estimates').set('Cookie', first.cookie)).status).toBe(401);
      expect((await request(app).get('/admin/estimates').set('Cookie', second.cookie)).status).toBe(401);
    });

    it('the refresh tokens of the revoked sessions stop working too', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await change(session.cookie, PASSWORD, NEW_PASSWORD);

      const res = await request(app).post('/admin/token/refresh').set('Cookie', `refresh_token=${session.refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has been revoked');
    });

    it('does not touch the sessions or the password of any other admin', async () => {
      const mine = await login(app, MASTER_USERNAME, PASSWORD);
      const theirs = await login(app, 'colleague', PASSWORD);
      const theirHash = (await account(otherId)).password_hash;

      await change(mine.cookie, PASSWORD, NEW_PASSWORD);

      expect(await sessionStates(otherId)).toEqual([false]);
      expect((await account(otherId)).password_hash).toBe(theirHash);
      expect((await request(app).get('/admin/estimates').set('Cookie', theirs.cookie)).status).toBe(200);
    });

    it('after the change the old password is refused and the new one logs in', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await change(session.cookie, PASSWORD, NEW_PASSWORD);

      expect((await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: PASSWORD })).status).toBe(401);
      expect((await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: NEW_PASSWORD })).status).toBe(200);
    });

    it('clears both cookies in the response', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      const res = await change(session.cookie, PASSWORD, NEW_PASSWORD);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.find(c => c.startsWith('access_token='))).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(cookies.find(c => c.startsWith('refresh_token='))).toMatch(/Expires=Thu, 01 Jan 1970/);
    });
  });

  describe('refused changes', () => {
    it('a wrong current password is 401, counted in the database, and changes nothing else', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const hash = (await account()).password_hash;

      const res = await change(session.cookie, WRONG_PASSWORD, NEW_PASSWORD);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect((await account()).failed_login_attempts).toBe(1);
      expect((await account()).password_hash).toBe(hash);
      expect(await sessionStates(MASTER_ID)).toEqual([false]);
    });

    it('five wrong attempts lock the account; then even the right password is refused', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      for (let i = 0; i < 5; i += 1) {
        await change(session.cookie, WRONG_PASSWORD, NEW_PASSWORD);
      }

      const locked = await account();
      expect(locked.failed_login_attempts).toBe(5);
      expect(locked.locked_until).not.toBeNull();
      const refused = await change(session.cookie, PASSWORD, NEW_PASSWORD);
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('ACCOUNT_LOCKED');
      expect((await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: PASSWORD })).status).toBe(401);
    });

    it('login failures and password-change failures share one counter', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: WRONG_PASSWORD });
      await change(session.cookie, WRONG_PASSWORD, NEW_PASSWORD);

      expect((await account()).failed_login_attempts).toBe(2);
    });

    it('a password that breaks the policy is 400 and does not count as a failed attempt', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      for (const weak of ['short1A!', 'alllowercaseletters', 'NoDigitsOrSymbolsHere']) {
        const res = await change(session.cookie, PASSWORD, weak);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PASSWORD_POLICY_VIOLATION');
      }

      expect((await account()).failed_login_attempts).toBe(0);
      expect(await sessionStates(MASTER_ID)).toEqual([false]);
    });

    it('a password longer than 72 bytes is refused, never cut', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      const tooLong = `Aa1!${'x'.repeat(69)}`; // 73 bytes

      const res = await change(session.cookie, PASSWORD, tooLong);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_TOO_LONG');
      expect(await bcrypt.compare(PASSWORD, (await account()).password_hash)).toBe(true);
    });

    it('the same password again is 422', async () => {
      await suite().db('admin_users').where({ id: MASTER_ID }).update({ password_hash: passwordHash('Same-Passw0rd-12') });
      const session = await login(app, MASTER_USERNAME, 'Same-Passw0rd-12');

      const res = await change(session.cookie, 'Same-Passw0rd-12', 'Same-Passw0rd-12');

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PASSWORD_SAME_AS_CURRENT');
      expect(await sessionStates(MASTER_ID)).toEqual([false]);
    });

    it('needs a session and JSON', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      expect((await request(app).patch('/admin/me/password').send({ current_password: PASSWORD, new_password: NEW_PASSWORD })).status).toBe(401);
      const text = await request(app).patch('/admin/me/password').set('Cookie', session.cookie).set('Content-Type', 'text/plain').send('x');
      expect(text.status).toBe(415);
    });

    it('a deactivated admin cannot change a password with an old session', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      await suite().db('admin_users').where({ id: MASTER_ID }).update({ is_active: false });

      expect((await change(session.cookie, PASSWORD, NEW_PASSWORD)).status).toBe(401);
    });
  });

  describe('at the same time (row lock)', () => {
    it('two parallel changes with the same current password: one wins, the other fails', async () => {
      const first = await login(app, MASTER_USERNAME, PASSWORD);
      const second = await login(app, MASTER_USERNAME, PASSWORD);

      const [a, b] = await Promise.all([
        change(first.cookie, PASSWORD, 'First-Passw0rd-12!'),
        change(second.cookie, PASSWORD, 'Second-Passw0rd-12!')
      ]);

      // The second one waits for the lock; after the first commit the current password is
      // different, or its session is already revoked.
      expect([a.status, b.status].sort()).toEqual([200, 401]);
      const hash = (await account()).password_hash;
      const winner = a.status === 200 ? 'First-Passw0rd-12!' : 'Second-Passw0rd-12!';
      expect(await bcrypt.compare(winner, hash)).toBe(true);
      expect(await sessionStates(MASTER_ID)).toEqual([true, true]);
    });

    const openSessions = async (): Promise<number> =>
      (await sessionStates(MASTER_ID)).filter(revoked => !revoked).length;

    // Whatever the interleaving, the old password must not leave an open session behind: either
    // the login is refused (the change came first) or the change revokes the new session.
    it.each(Array.from({ length: 12 }, (_, i) => [i + 1]))(
      'a login at the same time as a change leaves no open session (run %i)',
      async () => {
        await suite().db('admin_sessions').del();
        await suite().db('admin_users').where({ id: MASTER_ID }).update({ password_hash: passwordHash(PASSWORD) });
        const session = await login(app, MASTER_USERNAME, PASSWORD);

        const [changed, loggedIn] = await Promise.all([
          change(session.cookie, PASSWORD, NEW_PASSWORD),
          request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: PASSWORD })
        ]);

        expect(changed.status).toBe(200);
        expect([200, 401]).toContain(loggedIn.status);
        expect(await openSessions()).toBe(0);
        expect(await bcrypt.compare(NEW_PASSWORD, (await account()).password_hash)).toBe(true);
      }
    );

    it('the password changes while a login is still comparing: no session is issued, 401', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);

      // Hold only the next password comparison (the login's); the change must not be held.
      const realCompare = bcrypt.compare.bind(bcrypt);
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let started!: () => void;
      const comparing = new Promise<void>(resolve => {
        started = resolve;
      });
      let calls = 0;
      jest.spyOn(bcrypt, 'compare').mockImplementation(((...args: Parameters<typeof bcrypt.compare>) => {
        calls += 1;
        if (calls === 1) {
          started();
          return gate.then(() => realCompare(...args));
        }
        return realCompare(...args);
      }) as typeof bcrypt.compare);

      const pendingLogin = request(app)
        .post('/admin/login')
        .send({ username: MASTER_USERNAME, password: PASSWORD })
        .then(res => res);
      await comparing;

      const changed = await change(session.cookie, PASSWORD, NEW_PASSWORD);
      expect(changed.status).toBe(200);

      release();
      const loggedIn = await pendingLogin;

      // The password was right when it was compared, but no longer when the session would be created.
      expect(loggedIn.status).toBe(401);
      expect(loggedIn.headers['set-cookie']).toBeUndefined();
      expect(await openSessions()).toBe(0);
    });

    it('the old password is refused once the change has finished; the new one logs in', async () => {
      const session = await login(app, MASTER_USERNAME, PASSWORD);
      expect((await change(session.cookie, PASSWORD, NEW_PASSWORD)).status).toBe(200);

      expect((await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: PASSWORD })).status).toBe(401);
      expect((await request(app).post('/admin/login').send({ username: MASTER_USERNAME, password: NEW_PASSWORD })).status).toBe(200);
      expect(await openSessions()).toBe(1);
    });

    it('a login that finished first is revoked by the change that follows', async () => {
      const first = await login(app, MASTER_USERNAME, PASSWORD);
      const second = await login(app, MASTER_USERNAME, PASSWORD);

      expect((await change(first.cookie, PASSWORD, NEW_PASSWORD)).status).toBe(200);

      expect(await openSessions()).toBe(0);
      expect((await request(app).get('/admin/estimates').set('Cookie', second.cookie)).status).toBe(401);
    });
  });
});
