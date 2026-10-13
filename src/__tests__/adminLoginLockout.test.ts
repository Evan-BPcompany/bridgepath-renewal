jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { ADMIN_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

const PASSWORD = 'Correct-Horse-9';
const WRONG = 'Wrong-Horse-0000';
const MINUTE = 60_000;

describe('Admin login lockout (5 failures / 15 minutes, reset when a lock expires)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let row: Record<string, unknown>;
  let compareSpy: jest.SpyInstance;

  const passwordHash = bcrypt.hashSync(PASSWORD, 4);

  const setAccount = (overrides: Record<string, unknown> = {}) => {
    row = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
      ...overrides
    };
  };

  const login = (password: string) =>
    request(app).post('/admin/login').send({ username: 'master', password });

  const lockedForMinutes = () =>
    (new Date(row.locked_until as Date).getTime() - Date.now()) / MINUTE;

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    compareSpy = jest.spyOn(bcrypt, 'compare');

    setAccount();

    db.state.handler = (sql, params) => {
      if (sql.includes('password_hash') && sql.includes('WHERE username')) {
        return { rows: [{ ...row }] };
      }
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ ...row, id: params[0] }] };
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
      if (sql.includes('SET password_hash')) {
        row.password_hash = params[1];
        row.failed_login_attempts = 0;
        row.locked_until = null;
        return { rows: [] };
      }
      if (sql.includes('UPDATE admin_sessions SET is_revoked = true')) {
        return { rows: [], rowCount: 1 };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('counting and locking', () => {
    it('counts failures 1-4 without locking', async () => {
      for (let expected = 1; expected <= 4; expected += 1) {
        const res = await login(WRONG);
        expect(res.status).toBe(401);
        expect(row.failed_login_attempts).toBe(expected);
        expect(row.locked_until).toBeNull();
      }
    });

    it('login locks the account for 15 minutes on the 5th failed attempt', async () => {
      for (let i = 0; i < 5; i += 1) {
        await login(WRONG);
      }

      expect(row.failed_login_attempts).toBe(5);
      expect(lockedForMinutes()).toBeGreaterThan(14);
      expect(lockedForMinutes()).toBeLessThanOrEqual(15);
    });

    it('refuses a locked account, even with the right password, without comparing passwords', async () => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 10 * MINUTE) });

      const res = await login(PASSWORD);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Account is locked. Try again later.');
      expect(compareSpy).not.toHaveBeenCalled();
      expect(row.failed_login_attempts).toBe(5);
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_users'))).toBe(false);
    });

    it('a success after some failures clears the counter', async () => {
      await login(WRONG);
      await login(WRONG);
      expect(row.failed_login_attempts).toBe(2);

      const ok = await login(PASSWORD);
      expect(ok.status).toBe(200);
      expect(row.failed_login_attempts).toBe(0);

      await login(WRONG);
      expect(row.failed_login_attempts).toBe(1);
    });
  });

  describe('after the lock expires', () => {
    beforeEach(() => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() - MINUTE) });
    });

    it('resets failed_login_attempts and locked_until before checking the password', async () => {
      await login(WRONG);

      const updates = db.state.queries
        .filter(q => q.sql.includes('UPDATE admin_users'))
        .map(q => q.sql.replace(/\s+/g, ' ').trim());

      expect(updates[0]).toBe(
        'UPDATE admin_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1'
      );
      expect(updates[1]).toContain('SET failed_login_attempts = $1, locked_until = $2');
    });

    it('a wrong password counts as the first failure, not the sixth, and does not re-lock', async () => {
      const res = await login(WRONG);

      expect(res.status).toBe(401);
      expect(row.failed_login_attempts).toBe(1);
      expect(row.locked_until).toBeNull();
    });

    it('the correct password logs in and leaves clean counters', async () => {
      const res = await login(PASSWORD);

      expect(res.status).toBe(200);
      expect(row.failed_login_attempts).toBe(0);
      expect(row.locked_until).toBeNull();
      expect(db.state.queries.some(q => q.sql.includes('INSERT INTO admin_sessions'))).toBe(true);
    });

    it('needs five fresh failures to lock again', async () => {
      for (let expected = 1; expected <= 4; expected += 1) {
        await login(WRONG);
        expect(row.failed_login_attempts).toBe(expected);
        expect(row.locked_until).toBeNull();
      }

      await login(WRONG);
      expect(row.failed_login_attempts).toBe(5);
      expect(lockedForMinutes()).toBeGreaterThan(14);
    });

    it('does not write the reset when the lock is still active or absent', async () => {
      setAccount({ failed_login_attempts: 2, locked_until: null });
      await login(WRONG);

      const resets = db.state.queries.filter(q =>
        q.sql.replace(/\s+/g, ' ').includes('SET failed_login_attempts = 0, locked_until = NULL')
      );
      expect(resets).toHaveLength(0);
      expect(row.failed_login_attempts).toBe(3);
    });
  });

  describe('consistency with the password change endpoint', () => {
    const changePassword = (current: string, next: string) =>
      request(app)
        .patch('/admin/me/password')
        .set('Cookie', authCookie('admin'))
        .send({ current_password: current, new_password: next });

    it('both endpoints refuse a locked account', async () => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 10 * MINUTE) });

      const loginRes = await login(PASSWORD);
      const changeRes = await changePassword(PASSWORD, 'Another-Passw0rd!');

      expect(loginRes.status).toBe(401);
      expect(changeRes.status).toBe(401);
      expect(changeRes.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('both endpoints treat an expired lock as a fresh start and share one counter', async () => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() - MINUTE) });

      await changePassword(WRONG, 'Another-Passw0rd!');
      expect(row.failed_login_attempts).toBe(1);

      await login(WRONG);
      expect(row.failed_login_attempts).toBe(2);
    });

    it('after a password change the old password stops working and the new one logs in', async () => {
      const next = 'Another-Passw0rd!';

      const changed = await changePassword(PASSWORD, next);
      expect(changed.status).toBe(200);

      db.state.sessionRevoked = false;
      expect((await login(PASSWORD)).status).toBe(401);
      expect((await login(next)).status).toBe(200);
    });
  });
});
