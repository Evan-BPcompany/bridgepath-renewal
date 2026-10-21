jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import {
  RATE_LIMIT_DEFAULTS,
  RateLimitSettings,
  config,
  parseIntegerEnv,
  parseRateLimitSetting,
  parseRateLimits,
  parseTrustProxy
} from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import {
  ADMIN_ID,
  ESTIMATE_ID,
  MANAGER_ID,
  applyFailedLoginUpdate,
  authCookie,
  createFakeDb,
  isFailedLoginUpdate
} from './helpers/adminTestUtils';

const WINDOW = 15 * 60 * 1000;
const BIG = { windowMs: 60 * 60 * 1000, max: 100000 };
const PASSWORD = 'Correct-Horse-9';
const WRONG = 'Wrong-Horse-0000';

const limits = (overrides: Partial<RateLimitSettings>): RateLimitSettings => ({
  login: BIG,
  api: BIG,
  mutation: BIG,
  password: BIG,
  estimateCreate: BIG,
  estimateRead: BIG,
  estimatePreview: BIG,
  imageAnalysis: BIG,
  customerLogin: BIG,
  customerSignup: BIG,
  customerCode: BIG,
  ...overrides
});

describe('Rate limit configuration', () => {
  it('has the documented defaults', () => {
    expect(RATE_LIMIT_DEFAULTS).toEqual({
      login: { windowMs: 15 * 60 * 1000, max: 10 },
      api: { windowMs: 60 * 1000, max: 120 },
      mutation: { windowMs: 60 * 1000, max: 30 },
      password: { windowMs: 15 * 60 * 1000, max: 5 },
      estimateCreate: { windowMs: 60 * 60 * 1000, max: 10 },
      estimateRead: { windowMs: 15 * 60 * 1000, max: 30 },
      estimatePreview: { windowMs: 15 * 60 * 1000, max: 60 },
      imageAnalysis: { windowMs: 60 * 60 * 1000, max: 10 },
      customerLogin: { windowMs: 15 * 60 * 1000, max: 10 },
      customerSignup: { windowMs: 60 * 60 * 1000, max: 10 },
      customerCode: { windowMs: 15 * 60 * 1000, max: 20 }
    });
    expect(parseRateLimits({})).toEqual(RATE_LIMIT_DEFAULTS);
    expect(parseTrustProxy(undefined)).toBe(0);
  });

  it('reads overrides from the environment', () => {
    const parsed = parseRateLimits({
      ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS: '60000',
      ADMIN_LOGIN_RATE_LIMIT_MAX: '3',
      ADMIN_API_RATE_LIMIT_MAX: '500',
      ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS: '5000',
      ADMIN_PASSWORD_RATE_LIMIT_MAX: '2'
    });

    expect(parsed.login).toEqual({ windowMs: 60000, max: 3 });
    expect(parsed.api).toEqual({ windowMs: 60 * 1000, max: 500 });
    expect(parsed.mutation).toEqual({ windowMs: 5000, max: 30 });
    expect(parsed.password).toEqual({ windowMs: WINDOW, max: 2 });
  });

  it('uses the defaults when a variable is empty', () => {
    expect(parseRateLimits({ ADMIN_LOGIN_RATE_LIMIT_MAX: '  ' }).login.max).toBe(10);
  });

  it.each([['abc'], ['1.5'], ['-1'], ['0'], ['100001'], ['1e3'], ['10 0']])(
    'rejects ADMIN_API_RATE_LIMIT_MAX=%s',
    value => {
      expect(() => parseRateLimitSetting('ADMIN_API_RATE_LIMIT', { ADMIN_API_RATE_LIMIT_MAX: value }, RATE_LIMIT_DEFAULTS.api)).toThrow(
        'ADMIN_API_RATE_LIMIT_MAX must be an integer between 1 and 100000'
      );
    }
  );

  it('keeps the window between 1 second and 24 hours', () => {
    const parse = (value: string) =>
      parseRateLimitSetting('X', { X_WINDOW_MS: value }, RATE_LIMIT_DEFAULTS.api);

    expect(parse('1000').windowMs).toBe(1000);
    expect(parse('86400000').windowMs).toBe(86400000);
    expect(() => parse('999')).toThrow('X_WINDOW_MS must be an integer between 1000 and 86400000');
    expect(() => parse('86400001')).toThrow();
  });

  it('parseIntegerEnv falls back for missing values and validates ranges', () => {
    expect(parseIntegerEnv('N', undefined, 7, 1, 10)).toBe(7);
    expect(parseIntegerEnv('N', '5', 7, 1, 10)).toBe(5);
    expect(() => parseIntegerEnv('N', '11', 7, 1, 10)).toThrow('N must be an integer between 1 and 10');
  });

  it('TRUST_PROXY is a hop count from 0 to 10, never "true"', () => {
    expect(parseTrustProxy('0')).toBe(0);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10')).toBe(10);
    for (const bad of ['true', 'false', '-1', '11', '1.5', 'loopback']) {
      expect(() => parseTrustProxy(bad)).toThrow('TRUST_PROXY must be an integer between 0 and 10');
    }
  });

  it('the running config exposes the same shape (defaults unless the environment overrides them)', () => {
    expect(Object.keys(config.rateLimits).sort()).toEqual([
      'api',
      'customerCode',
      'customerLogin',
      'customerSignup',
      'estimateCreate',
      'estimatePreview',
      'estimateRead',
      'imageAnalysis',
      'login',
      'mutation',
      'password'
    ]);
    expect(Number.isInteger(config.trustProxy)).toBe(true);
  });
});

describe('Rate limiting (mocked database)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let accounts: Record<string, Record<string, unknown>>;

  const hash = bcrypt.hashSync(PASSWORD, 4);

  const makeApp = (overrides: Partial<RateLimitSettings>, trustProxy = 0): Express =>
    createApp({ rateLimits: limits(overrides), trustProxy });

  const attempt = (app: Express, username: string, password: string, ip?: string) => {
    const req = request(app).post('/admin/login');
    if (ip) {
      req.set('X-Forwarded-For', ip);
    }
    return req.send({ username, password });
  };

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const base = {
      email: 'x@bridgepath.local',
      password_hash: hash,
      role: 'admin',
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null
    };
    accounts = {
      master: { ...base, id: ADMIN_ID, username: 'master' },
      second: { ...base, id: 'a0000000-0000-0000-0000-000000000009', username: 'second' }
    };

    db.state.handler = (sql, params) => {
      if (sql.includes('password_hash') && sql.includes('WHERE username')) {
        const row = accounts[params[0] as string];
        return { rows: row ? [{ ...row }] : [] };
      }
      const byId = (id: unknown) => Object.values(accounts).find(a => a.id === id);
      if (sql.includes('FROM admin_users WHERE id = $1 FOR UPDATE')) {
        const row = byId(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (isFailedLoginUpdate(sql)) {
        const row = byId(params[0]);
        return row ? applyFailedLoginUpdate(row, params) : { rows: [] };
      }
      if (/SET failed_login_attempts = 0, locked_until = null/i.test(sql)) {
        const row = byId(params[0]);
        if (row) {
          row.failed_login_attempts = 0;
          row.locked_until = null;
        }
        return { rows: [] };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('login limiter (per IP, failed attempts only)', () => {
    it('answers 429 RATE_LIMITED with Retry-After once failures exceed the limit', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } });

      for (let i = 0; i < 3; i += 1) {
        expect((await attempt(app, 'master', WRONG)).status).toBe(401);
      }

      const blocked = await attempt(app, 'master', WRONG);

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
      expect(blocked.body.retry_after_seconds).toBeGreaterThanOrEqual(1);
      expect(blocked.body.retry_after_seconds).toBeLessThanOrEqual(900);
      expect(blocked.headers['retry-after']).toBe(String(blocked.body.retry_after_seconds));
      expect(blocked.headers['ratelimit-policy']).toBeDefined();
      expect(Object.keys(blocked.body).sort()).toEqual(['code', 'error', 'retry_after_seconds', 'timestamp']);
    });

    it('does not count successful logins', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } });

      for (let i = 0; i < 6; i += 1) {
        expect((await attempt(app, 'master', PASSWORD)).status).toBe(200);
      }

      for (let i = 0; i < 3; i += 1) {
        expect((await attempt(app, 'master', WRONG)).status).toBe(401);
      }
      expect((await attempt(app, 'master', WRONG)).status).toBe(429);
    });

    it('rejects even the correct password once the limit is exhausted', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 2 } });

      await attempt(app, 'master', WRONG);
      await attempt(app, 'master', WRONG);

      expect((await attempt(app, 'master', PASSWORD)).status).toBe(429);
    });

    it('counts every kind of failed request: unknown users and missing passwords too', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } });

      expect((await attempt(app, 'ghost', WRONG)).status).toBe(401);
      expect((await request(app).post('/admin/login').send({ username: 'master' })).status).toBe(400);
      expect((await attempt(app, 'master', WRONG)).status).toBe(401);
      expect((await attempt(app, 'master', WRONG)).status).toBe(429);
    });

    it('tracks each client IP separately when TRUST_PROXY=1', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } }, 1);

      for (let i = 0; i < 3; i += 1) {
        await attempt(app, 'master', WRONG, '10.0.0.1');
      }

      expect((await attempt(app, 'master', WRONG, '10.0.0.1')).status).toBe(429);
      expect((await attempt(app, 'master', WRONG, '10.0.0.2')).status).toBe(401);
    });

    it('ignores X-Forwarded-For when TRUST_PROXY=0, so the header cannot be used to dodge the limit', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } }, 0);

      await attempt(app, 'master', WRONG, '10.0.0.1');
      await attempt(app, 'master', WRONG, '10.0.0.2');
      await attempt(app, 'master', WRONG, '10.0.0.3');

      expect((await attempt(app, 'master', WRONG, '10.0.0.4')).status).toBe(429);
    });

    it('only trusts the configured number of proxies', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 2 } }, 1);

      // With one trusted proxy the client is the last address; earlier entries are forgeable.
      await attempt(app, 'master', WRONG, '6.6.6.1, 10.0.0.1');
      await attempt(app, 'master', WRONG, '6.6.6.2, 10.0.0.1');

      expect((await attempt(app, 'master', WRONG, '6.6.6.3, 10.0.0.1')).status).toBe(429);
    });
  });

  describe('interaction with the account lockout (5 failures / 15 minutes)', () => {
    it('the lockout triggers first when the IP limit is higher: locked, not 429', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 10 } });

      for (let i = 0; i < 5; i += 1) {
        expect((await attempt(app, 'master', WRONG)).status).toBe(401);
      }
      expect(accounts.master.locked_until).not.toBeNull();

      const locked = await attempt(app, 'master', PASSWORD);
      expect(locked.status).toBe(401);
      expect(locked.body.error).toBe('Account is locked. Try again later.');

      // The lock is per account: another account on the same IP can still log in.
      expect((await attempt(app, 'second', PASSWORD)).status).toBe(200);
    });

    it('attempts on a locked account still use up the IP budget', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 10 } });

      for (let i = 0; i < 10; i += 1) {
        await attempt(app, 'master', WRONG);
      }

      // 10 failed requests from this IP: now even another account is blocked.
      expect((await attempt(app, 'second', PASSWORD)).status).toBe(429);
    });

    it('the IP limiter triggers first when it is lower, without touching the account counter', async () => {
      const app = makeApp({ login: { windowMs: WINDOW, max: 3 } });

      for (let i = 0; i < 3; i += 1) {
        await attempt(app, 'master', WRONG);
      }
      expect(accounts.master.failed_login_attempts).toBe(3);

      expect((await attempt(app, 'master', WRONG)).status).toBe(429);
      expect(accounts.master.failed_login_attempts).toBe(3);
      expect(accounts.master.locked_until).toBeNull();
    });
  });

  describe('general admin limiter (per IP)', () => {
    it('limits authenticated requests', async () => {
      const app = makeApp({ api: { windowMs: 60_000, max: 3 } });
      db.state.handler = sql => (sql.includes('COUNT(*)::int AS total FROM estimates') ? { rows: [{ total: 0 }] } : undefined);

      for (let i = 0; i < 3; i += 1) {
        expect((await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'))).status).toBe(200);
      }

      const blocked = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
    });

    it('also counts unauthenticated requests and token refresh calls', async () => {
      const unauthenticated = makeApp({ api: { windowMs: 60_000, max: 3 } });
      for (let i = 0; i < 3; i += 1) {
        expect((await request(unauthenticated).get('/admin/estimates')).status).toBe(401);
      }
      expect((await request(unauthenticated).get('/admin/estimates')).status).toBe(429);

      const refresh = makeApp({ api: { windowMs: 60_000, max: 3 } });
      for (let i = 0; i < 3; i += 1) {
        expect((await request(refresh).post('/admin/token/refresh')).status).toBe(401);
      }
      expect((await request(refresh).post('/admin/token/refresh')).status).toBe(429);
    });

    it('is per IP when TRUST_PROXY=1', async () => {
      const app = makeApp({ api: { windowMs: 60_000, max: 2 } }, 1);

      await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.0.0.1');
      await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.0.0.1');

      expect((await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.0.0.1')).status).toBe(429);
      expect((await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.0.0.2')).status).toBe(401);
    });

    it('does not apply to /health or the public customer API (which has its own limiters)', async () => {
      const app = makeApp({ api: { windowMs: 60_000, max: 1 }, login: { windowMs: WINDOW, max: 1 } });

      for (let i = 0; i < 8; i += 1) {
        expect((await request(app).get('/health')).status).toBe(200);
        expect((await request(app).post('/api/estimates').send({})).status).toBe(400);
      }
    });
  });

  describe('mutation limiter (per admin)', () => {
    const patchStatus = (app: Express, role: 'admin' | 'manager', ip?: string) => {
      const req = request(app)
        .patch(`/admin/estimates/${ESTIMATE_ID}/status`)
        .set('Cookie', authCookie(role));
      if (ip) {
        req.set('X-Forwarded-For', ip);
      }
      return req.send({ to_status: 'under_review' });
    };

    it('limits status changes per admin and answers 429 before validating the request', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 2 } });

      expect((await patchStatus(app, 'admin')).status).toBe(404);
      expect((await patchStatus(app, 'admin')).status).toBe(404);

      const blocked = await patchStatus(app, 'admin');
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');

      const invalidBody = await request(app)
        .patch(`/admin/estimates/${ESTIMATE_ID}/status`)
        .set('Cookie', authCookie('admin'))
        .send({});
      expect(invalidBody.status).toBe(429);
    });

    it('gives every admin their own budget', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 1 } });

      expect((await patchStatus(app, 'admin')).status).toBe(404);
      expect((await patchStatus(app, 'admin')).status).toBe(429);
      expect((await patchStatus(app, 'manager')).status).toBe(404);
      expect((await patchStatus(app, 'manager')).status).toBe(429);
    });

    it('follows the admin across IP addresses', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 1 } }, 1);

      expect((await patchStatus(app, 'admin', '10.0.0.1')).status).toBe(404);
      expect((await patchStatus(app, 'admin', '10.0.0.2')).status).toBe(429);
    });

    it('shares one budget between status changes and memo creation', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 2 } });

      expect((await patchStatus(app, 'admin')).status).toBe(404);
      const memo = await request(app)
        .post(`/admin/estimates/${ESTIMATE_ID}/memos`)
        .set('Cookie', authCookie('admin'))
        .send({ content: 'note' });
      expect(memo.status).toBe(404);

      expect((await patchStatus(app, 'admin')).status).toBe(429);
    });

    it('does not count reads', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 1 } });
      db.state.handler = sql => (sql.includes('COUNT(*)::int AS total FROM estimates') ? { rows: [{ total: 0 }] } : undefined);

      for (let i = 0; i < 6; i += 1) {
        expect((await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'))).status).toBe(200);
      }
      expect((await patchStatus(app, 'admin')).status).toBe(404);
    });

    it('does not let unauthenticated requests use up an admin budget', async () => {
      const app = makeApp({ mutation: { windowMs: 60_000, max: 1 } });

      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .patch(`/admin/estimates/${ESTIMATE_ID}/status`)
          .send({ to_status: 'under_review' });
        expect(res.status).toBe(401);
      }

      expect((await patchStatus(app, 'admin')).status).toBe(404);
    });
  });

  describe('password change limiter (per admin)', () => {
    const changePassword = (app: Express, role: 'admin' | 'manager' = 'admin') =>
      request(app).patch('/admin/me/password').set('Cookie', authCookie(role)).send({});

    it('limits attempts per admin', async () => {
      const app = makeApp({ password: { windowMs: WINDOW, max: 2 } });

      expect((await changePassword(app)).status).toBe(400);
      expect((await changePassword(app)).status).toBe(400);
      expect((await changePassword(app)).status).toBe(429);

      expect((await changePassword(app, 'manager')).status).toBe(400);
    });

    it('does not count unauthenticated requests', async () => {
      const app = makeApp({ password: { windowMs: WINDOW, max: 1 } });

      for (let i = 0; i < 4; i += 1) {
        expect((await request(app).patch('/admin/me/password').send({})).status).toBe(401);
      }
      expect((await changePassword(app)).status).toBe(400);
    });

    it('uses the documented default of 5 attempts per 15 minutes', async () => {
      const app = createApp({ rateLimits: { api: BIG } });

      for (let i = 0; i < RATE_LIMIT_DEFAULTS.password.max; i += 1) {
        expect((await changePassword(app)).status).toBe(400);
      }
      expect((await changePassword(app)).status).toBe(429);
    });
  });

  describe('stability in tests', () => {
    it('every app has its own counters, so tests cannot affect each other', async () => {
      const first = makeApp({ login: { windowMs: WINDOW, max: 1 } });
      const second = makeApp({ login: { windowMs: WINDOW, max: 1 } });

      await attempt(first, 'master', WRONG);
      expect((await attempt(first, 'master', WRONG)).status).toBe(429);
      expect((await attempt(second, 'master', WRONG)).status).toBe(401);
    });

    it('works with no overrides using the configured defaults', async () => {
      const app = createApp();
      expect((await request(app).get('/health')).status).toBe(200);
      expect((await attempt(app, 'master', PASSWORD)).status).toBe(200);
    });

    it('the first request of a fresh window is never limited', async () => {
      const app = makeApp({ api: { windowMs: 1000, max: 1 }, login: { windowMs: 1000, max: 1 } });
      expect((await request(app).get('/admin/estimates')).status).toBe(401);
    });

    it('never leaks the limiter store or other clients in the 429 body', async () => {
      const app = makeApp({ api: { windowMs: 60_000, max: 1 } }, 1);
      await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.9.9.9');
      const blocked = await request(app).get('/admin/estimates').set('X-Forwarded-For', '10.9.9.9');

      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).not.toContain('10.9.9.9');
      expect(MANAGER_ID).toBeDefined();
    });
  });
});
