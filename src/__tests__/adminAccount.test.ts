jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { comparePassword } from '../utils/hash';
import {
  ADMIN_ID,
  MANAGER_ID,
  authCookie,
  createFakeDb,
  applyFailedLoginUpdate,
  isFailedLoginUpdate
} from './helpers/adminTestUtils';

const PASSWORD_URL = '/admin/me/password';
const CURRENT = 'Current-Passw0rd!';
const NEW = 'Brand-New-Passw0rd!';

describe('PATCH /admin/me/password (mocked database)', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let row: Record<string, unknown>;
  let sessionRevocations: number;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let compareSpy: jest.SpyInstance;

  const fixtureHash = bcrypt.hashSync(CURRENT, 4);

  const setAccount = (overrides: Record<string, unknown> = {}) => {
    row = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: fixtureHash,
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
      ...overrides
    };
  };

  const change = (
    body: unknown,
    role: 'admin' | 'manager' = 'admin'
  ) => request(app).patch(PASSWORD_URL).set('Cookie', authCookie(role)).send(body as object);

  const allLogged = () => JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);

  const auditRecords = () =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .map(call => String(call[0]))
      .filter(message => message.startsWith('admin_audit'))
      .map(message => JSON.parse(message.replace('admin_audit ', '')));

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    // The lockout tests send more requests than the default password limiter allows;
    // the limiter itself is covered in rateLimit.test.ts.
    app = createApp({ rateLimits: { password: { windowMs: 15 * 60 * 1000, max: 1000 } } });
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    compareSpy = jest.spyOn(bcrypt, 'compare');

    setAccount();
    sessionRevocations = 0;

    db.state.handler = (sql, params) => {
      if (sql.includes('FROM admin_users WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ ...row, id: params[0] }] };
      }
      if (sql.includes('SET password_hash')) {
        row.password_hash = params[1];
        row.failed_login_attempts = 0;
        row.locked_until = null;
        return { rows: [] };
      }
      if (isFailedLoginUpdate(sql)) {
        return applyFailedLoginUpdate(row, params);
      }
      if (sql.includes('UPDATE admin_sessions SET is_revoked = true')) {
        sessionRevocations += 1;
        db.state.sessionRevoked = true;
        return { rows: [], rowCount: 2 };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lockQueries = () => db.state.queries.filter(q => q.sql.includes('FOR UPDATE'));
  const writes = () =>
    db.state.queries.filter(q => /UPDATE admin_(users|sessions)/.test(q.sql));

  describe('request checks', () => {
    it('requires authentication', async () => {
      const none = await request(app).patch(PASSWORD_URL).send({ current_password: CURRENT, new_password: NEW });
      expect(none.status).toBe(401);

      db.state.sessionRevoked = true;
      const revoked = await change({ current_password: CURRENT, new_password: NEW });
      expect(revoked.status).toBe(401);

      expect(lockQueries()).toHaveLength(0);
    });

    it('requires a JSON body', async () => {
      const res = await request(app)
        .patch(PASSWORD_URL)
        .set('Cookie', authCookie('admin'))
        .type('form')
        .send(`current_password=${CURRENT}&new_password=${NEW}`);

      expect(res.status).toBe(415);
      expect(lockQueries()).toHaveLength(0);
    });

    it.each([
      [{}],
      [[]],
      [{ current_password: CURRENT }],
      [{ new_password: NEW }],
      [{ current_password: '', new_password: NEW }],
      [{ current_password: CURRENT, new_password: '' }],
      [{ current_password: 123, new_password: NEW }],
      [{ current_password: CURRENT, new_password: { a: 1 } }]
    ])('returns 400 VALIDATION_ERROR for %j', async body => {
      const res = await change(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(lockQueries()).toHaveLength(0);
    });
  });

  describe('maximum length: 72 UTF-8 bytes, no truncation', () => {
    it.each([
      ['73 ASCII bytes', `Aa1${'x'.repeat(70)}`],
      ['75 bytes of Korean (25 characters)', `${'가'.repeat(25)}`],
      ['74 bytes ending in a 3-byte character', `Aa1${'x'.repeat(68)}가`]
    ])('rejects %s with 400 PASSWORD_TOO_LONG before touching the database', async (_label, password) => {
      const res = await change({ current_password: CURRENT, new_password: password });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_TOO_LONG');
      expect(res.body.details).toEqual({ max_bytes: 72 });
      expect(lockQueries()).toHaveLength(0);
      expect(writes()).toHaveLength(0);
      expect(JSON.stringify(res.body)).not.toContain(password);
    });

    it('accepts exactly 72 bytes and stores the full password, not a cut version', async () => {
      const exact = `Aa1${'x'.repeat(69)}`;
      expect(Buffer.byteLength(exact, 'utf8')).toBe(72);

      const res = await change({ current_password: CURRENT, new_password: exact });
      expect(res.status).toBe(200);

      const stored = row.password_hash as string;
      expect(await comparePassword(exact, stored)).toBe(true);
      // The verification code also refuses a longer password that merely starts with it.
      expect(await comparePassword(`${exact}EXTRA`, stored)).toBe(false);
    });

    it('accepts 72 bytes of mixed Korean and ASCII (26 characters)', async () => {
      const exact = `${'가'.repeat(23)}aB1`;
      expect(Buffer.byteLength(exact, 'utf8')).toBe(72);

      const res = await change({ current_password: CURRENT, new_password: exact });
      expect(res.status).toBe(200);
      expect(await comparePassword(exact, row.password_hash as string)).toBe(true);
    });

    it('treats a current password over 72 bytes as wrong without calling bcrypt, and counts it', async () => {
      const res = await change({ current_password: 'x'.repeat(100), new_password: NEW });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(compareSpy).not.toHaveBeenCalled();
      expect(row.failed_login_attempts).toBe(1);
    });
  });

  describe('password policy (12 characters minimum)', () => {
    it('returns 400 PASSWORD_POLICY_VIOLATION with every violation', async () => {
      const res = await change({ current_password: CURRENT, new_password: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_POLICY_VIOLATION');
      expect(res.body.details).toEqual({
        violations: expect.arrayContaining(['TOO_SHORT', 'NOT_ENOUGH_CHARACTER_TYPES']),
        min_characters: 12,
        max_bytes: 72,
        min_character_types: 3
      });
    });

    it('measures the minimum in characters: 7 characters / 15 bytes is too short', async () => {
      const res = await change({ current_password: CURRENT, new_password: '가나다라aA1' });

      expect(res.status).toBe(400);
      expect(res.body.details.violations).toContain('TOO_SHORT');
    });

    it('rejects the account name and the seeded default password', async () => {
      setAccount({ username: 'Operator-Account9' });
      const sameAsUsername = await change({ current_password: CURRENT, new_password: 'operator-account9' });
      expect(sameAsUsername.body.details.violations).toContain('MATCHES_ACCOUNT_INFO');

      const defaultPassword = await change({
        current_password: CURRENT,
        new_password: 'CHANGE_ME_ON_FIRST_LOGIN'
      });
      expect(defaultPassword.body.details.violations).toContain('MATCHES_DEFAULT_PASSWORD');
    });

    it('does not count a policy failure as a failed login and changes nothing', async () => {
      const res = await change({ current_password: 'definitely-wrong', new_password: 'abc' });

      expect(res.status).toBe(400);
      expect(row.failed_login_attempts).toBe(0);
      expect(writes()).toHaveLength(0);
      expect(compareSpy).not.toHaveBeenCalled();
    });
  });

  describe('current password and lockout', () => {
    it('returns 401 INVALID_CURRENT_PASSWORD and counts the failure', async () => {
      const res = await change({ current_password: 'wrong-password-1', new_password: NEW });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(row.failed_login_attempts).toBe(1);
      expect(row.locked_until).toBeNull();
      expect(row.password_hash).toBe(fixtureHash);
      expect(sessionRevocations).toBe(0);

      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements[statements.length - 1]).toBe('COMMIT');
    });

    it('locks the account on the 5th failure for 15 minutes, then refuses even the right password', async () => {
      for (let i = 0; i < 5; i += 1) {
        const res = await change({ current_password: `wrong-password-${i}`, new_password: NEW });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');
      }

      expect(row.failed_login_attempts).toBe(5);
      const lockedUntil = new Date(row.locked_until as Date).getTime();
      expect(lockedUntil - Date.now()).toBeGreaterThan(14 * 60_000);
      expect(lockedUntil - Date.now()).toBeLessThanOrEqual(15 * 60_000);

      compareSpy.mockClear();
      const locked = await change({ current_password: CURRENT, new_password: NEW });

      expect(locked.status).toBe(401);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      expect(compareSpy).not.toHaveBeenCalled();
      expect(row.password_hash).toBe(fixtureHash);
      expect(sessionRevocations).toBe(0);
    });

    it('starts counting from zero once a lock has expired', async () => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() - 60_000) });

      const wrong = await change({ current_password: 'wrong-password-1', new_password: NEW });

      expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(row.failed_login_attempts).toBe(1);
      expect(row.locked_until).toBeNull();
    });

    it('lets the right password through after a lock has expired, and clears the counters', async () => {
      setAccount({ failed_login_attempts: 5, locked_until: new Date(Date.now() - 60_000) });

      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(200);
      expect(row.failed_login_attempts).toBe(0);
      expect(row.locked_until).toBeNull();
    });

    it('a success after a few failures resets the failure counter', async () => {
      setAccount({ failed_login_attempts: 3 });

      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(200);
      expect(row.failed_login_attempts).toBe(0);
    });

    it('returns 401 ACCOUNT_UNAVAILABLE for an account that became inactive', async () => {
      setAccount({ is_active: false });
      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('ACCOUNT_UNAVAILABLE');
    });
  });

  describe('same password', () => {
    it('returns 422 PASSWORD_SAME_AS_CURRENT and changes nothing', async () => {
      const res = await change({ current_password: CURRENT, new_password: CURRENT });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PASSWORD_SAME_AS_CURRENT');
      expect(row.password_hash).toBe(fixtureHash);
      expect(sessionRevocations).toBe(0);
      expect(row.failed_login_attempts).toBe(0);
    });
  });

  describe('successful change', () => {
    it('stores a cost-12 bcrypt hash of the new password and clears the counters', async () => {
      setAccount({ failed_login_attempts: 2 });
      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(200);
      const stored = row.password_hash as string;
      expect(stored).not.toBe(fixtureHash);
      expect(bcrypt.getRounds(stored)).toBe(12);
      expect(await comparePassword(NEW, stored)).toBe(true);
      expect(await comparePassword(CURRENT, stored)).toBe(false);
      expect(row.failed_login_attempts).toBe(0);
      expect(row.locked_until).toBeNull();

      const update = db.state.queries.find(q => q.sql.includes('SET password_hash'))!;
      expect(update.sql).toContain('updated_at = CURRENT_TIMESTAMP');
    });

    it('works for a manager changing their own password', async () => {
      const res = await change({ current_password: CURRENT, new_password: NEW }, 'manager');

      expect(res.status).toBe(200);
      const update = db.state.queries.find(q => q.sql.includes('SET password_hash'))!;
      expect(update.params[0]).toBe(MANAGER_ID);
    });

    it('revokes every session of the admin, the current one included, in one transaction', async () => {
      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(200);

      const revoke = db.state.queries.find(q => q.sql.includes('UPDATE admin_sessions SET is_revoked = true'))!;
      expect(revoke.sql).toContain('WHERE admin_user_id = $1 AND is_revoked = false');
      expect(revoke.sql).not.toMatch(/\bid\s*(<>|!=)/);
      expect(revoke.params).toEqual([ADMIN_ID]);

      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements[0]).toBe('BEGIN');
      expect(statements[statements.length - 1]).toBe('COMMIT');
      expect(statements.some(s => s.includes('FOR UPDATE'))).toBe(true);
      expect(db.client.release).toHaveBeenCalled();
    });

    it('makes the old token unusable immediately and clears both cookies', async () => {
      const cookie = authCookie('admin');
      const res = await request(app)
        .patch(PASSWORD_URL)
        .set('Cookie', cookie)
        .send({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Password changed. All sessions were signed out; please log in again.',
        data: { reauthentication_required: true }
      });

      const cleared = res.headers['set-cookie'] as unknown as string[];
      const access = cleared.find(c => c.startsWith('access_token='))!;
      const refresh = cleared.find(c => c.startsWith('refresh_token='))!;
      expect(access).toMatch(/Path=\/admin(;|$)/);
      expect(access).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(refresh).toMatch(/Path=\/admin\/token\/refresh/);
      expect(refresh).toMatch(/Expires=Thu, 01 Jan 1970/);

      const after = await request(app).get('/admin/estimates').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    it('rolls back and returns 500 if revoking the sessions fails', async () => {
      const handler = db.state.handler;
      db.state.handler = (sql, params) => {
        if (sql.includes('UPDATE admin_sessions SET is_revoked = true')) {
          throw new Error('boom');
        }
        return handler(sql, params);
      };

      const res = await change({ current_password: CURRENT, new_password: NEW });

      expect(res.status).toBe(500);
      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements).toContain('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
      expect(db.client.release).toHaveBeenCalled();
    });
  });

  describe('secrets stay out of responses and logs', () => {
    it('never echoes or logs passwords, hashes or tokens', async () => {
      const responses = [
        await change({ current_password: CURRENT, new_password: NEW }),
        await change({ current_password: 'wrong-password-1', new_password: NEW }),
        await change({ current_password: CURRENT, new_password: 'abc' }),
        await change({ current_password: CURRENT, new_password: `Aa1${'x'.repeat(80)}` })
      ];

      const secrets = [CURRENT, NEW, 'wrong-password-1', fixtureHash, String(row.password_hash)];
      const everything = allLogged() + JSON.stringify(responses.map(r => r.body));

      for (const secret of secrets) {
        expect(everything).not.toContain(secret);
      }
      expect(everything).not.toMatch(/\$2[aby]\$/);
    });

    it('audits success and denials with the admin id and error code only', async () => {
      await change({ current_password: 'wrong-password-1', new_password: NEW }, 'manager');
      setAccount();
      db.state.sessionRevoked = false;
      await change({ current_password: CURRENT, new_password: NEW }, 'admin');

      const records = auditRecords();
      expect(records).toHaveLength(2);

      const denied = records.find(r => r.result === 'denied');
      const success = records.find(r => r.result === 'success');

      expect(denied).toMatchObject({
        action: 'admin.password.change',
        result: 'denied',
        http_status: 401,
        error_code: 'INVALID_CURRENT_PASSWORD',
        admin_id: MANAGER_ID,
        role: 'manager'
      });
      expect(success).toMatchObject({
        action: 'admin.password.change',
        result: 'success',
        http_status: 200,
        admin_id: ADMIN_ID
      });
      expect(Object.keys(success!).sort()).toEqual(
        ['action', 'admin_id', 'http_status', 'ip', 'result', 'role'].sort()
      );
    });
  });
});
