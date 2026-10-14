jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import {
  ADMIN_ID,
  applyFailedLoginUpdate,
  authCookie,
  createFakeDb,
  isFailedLoginUpdate
} from './helpers/adminTestUtils';

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
      if (isFailedLoginUpdate(sql)) {
        return applyFailedLoginUpdate(row, params);
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

    it('restarts the count inside the one atomic UPDATE, without a separate reset first', async () => {
      await login(WRONG);

      const updates = db.state.queries
        .filter(q => q.sql.includes('UPDATE admin_users'))
        .map(q => q.sql.replace(/\s+/g, ' ').trim());

      expect(updates).toHaveLength(1);
      expect(updates[0]).toContain('SET failed_login_attempts = CASE');
      expect(updates[0]).toContain('RETURNING failed_login_attempts, locked_until');
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

    it('counts one failure with one UPDATE when there is no lock', async () => {
      setAccount({ failed_login_attempts: 2, locked_until: null });
      await login(WRONG);

      const updates = db.state.queries.filter(q => q.sql.includes('UPDATE admin_users'));
      expect(updates).toHaveLength(1);
      expect(row.failed_login_attempts).toBe(3);
    });
  });

  describe('concurrency rules (the counter is incremented by the database, not by the route)', () => {
    it('the failure UPDATE increments from the stored value and takes no value from the route', async () => {
      await login(WRONG);

      const update = db.state.queries.find(q => isFailedLoginUpdate(q.sql))!;
      expect(update.sql).toContain('COALESCE(failed_login_attempts, 0) + 1');
      expect(update.params).toEqual([ADMIN_ID, expect.any(Date), 5, 15 * MINUTE]);
    });

    it('does not hold a row lock while the password is compared', async () => {
      let lockedDuringCompare: boolean | undefined;
      compareSpy.mockImplementationOnce(async () => {
        lockedDuringCompare = db.state.queries.some(q => q.sql.includes('FOR UPDATE'));
        return false;
      });

      await login(WRONG);

      expect(lockedDuringCompare).toBe(false);
      expect(db.state.queries.some(q => q.sql.includes('FOR UPDATE'))).toBe(false);
    });

    it('a failed login never starts a transaction', async () => {
      await login(WRONG);

      expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('the late failure of a parallel burst leaves an active lock and its counter alone', async () => {
      const until = new Date(Date.now() + 10 * MINUTE);
      setAccount({ failed_login_attempts: 5, locked_until: until });

      const result = applyFailedLoginUpdate(row, [ADMIN_ID, new Date(), 5, 15 * MINUTE]);

      expect(result.rows[0].failed_login_attempts).toBe(5);
      expect(row.locked_until).toBe(until);
    });
  });

  describe('success path: the account is locked and checked again before a session exists', () => {
    const sessionInserts = () => db.state.queries.filter(q => q.sql.includes('INSERT INTO admin_sessions'));

    it('locks the admin row (FOR UPDATE) before inserting the session, in one transaction', async () => {
      const res = await login(PASSWORD);

      expect(res.status).toBe(200);
      const statements = db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());
      const lock = statements.findIndex(sql => sql.includes('FROM admin_users WHERE id = $1 FOR UPDATE'));
      const insert = statements.findIndex(sql => sql.includes('INSERT INTO admin_sessions'));
      expect(statements[0]).toBe('BEGIN');
      expect(lock).toBeGreaterThan(0);
      expect(insert).toBeGreaterThan(lock);
      expect(statements[statements.length - 1]).toBe('COMMIT');
    });

    it('issues no session when the password changed after it was verified', async () => {
      compareSpy.mockImplementationOnce(async () => {
        // A password change commits while this login is still comparing.
        row.password_hash = bcrypt.hashSync('Brand-New-Passw0rd!', 4);
        return true;
      });

      const res = await login(PASSWORD);

      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(sessionInserts()).toHaveLength(0);
      expect(db.client.query.mock.calls.map(call => call[0])).toContain('ROLLBACK');
    });

    it('issues no session when the account was deactivated meanwhile', async () => {
      compareSpy.mockImplementationOnce(async () => {
        row.is_active = false;
        return true;
      });

      const res = await login(PASSWORD);

      expect(res.status).toBe(401);
      expect(sessionInserts()).toHaveLength(0);
    });

    it('issues no session when the account got locked meanwhile', async () => {
      compareSpy.mockImplementationOnce(async () => {
        row.failed_login_attempts = 5;
        row.locked_until = new Date(Date.now() + 10 * MINUTE);
        return true;
      });

      const res = await login(PASSWORD);

      expect(res.status).toBe(401);
      expect(sessionInserts()).toHaveLength(0);
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
