jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({
  storeFiles: jest.fn(),
  discardStoredFiles: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import {
  RATE_LIMIT_DEFAULTS,
  RateLimitSettings,
  parseRateLimits
} from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { storeFiles } from '../services/fileService';
import { createFakeDb } from './helpers/adminTestUtils';
import { PROFILE } from './helpers/customerFixtures';

// The public customer API limiters: POST /api/estimates (default 10 per hour per IP) and
// GET /api/estimates/:receipt_id (default 30 per 15 minutes per IP). No real database, S3 or
// SendGrid: the services are mocks and the pool is a fake.

const HOUR = 60 * 60 * 1000;
const QUARTER = 15 * 60 * 1000;
const BIG = { windowMs: HOUR, max: 100000 };
const CREATED = {
  success: true,
  receipt_id: 'BP20261013001',
  estimate_id: 'internal',
  status: 'new_receipt',
  access_token: 'a'.repeat(64),
  created_at: '2026-10-13T03:00:00.000Z'
};
const SPEC = { schema_version: '1.0', shoe_type: 'Running', material: 'Mesh', size_range: '240-250', quantity: 500 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const RECEIPT = 'BP20261013001';

const FAKE_ONLY_DATE: Array<
  | 'hrtime' | 'nextTick' | 'performance' | 'queueMicrotask' | 'requestAnimationFrame'
  | 'cancelAnimationFrame' | 'requestIdleCallback' | 'cancelIdleCallback' | 'setImmediate'
  | 'clearImmediate' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'
> = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'
];

const limits = (overrides: Partial<RateLimitSettings>): RateLimitSettings => ({
  login: BIG,
  api: BIG,
  mutation: BIG,
  password: BIG,
  estimateCreate: BIG,
  estimateRead: BIG,
  estimatePreview: BIG,
  imageAnalysis: BIG,
  ...overrides
});

describe('public customer API rate limits', () => {
  let db: ReturnType<typeof createFakeDb>;
  const create = jest.mocked(createEstimate);
  const lookup = jest.mocked(getEstimateByReceiptId);
  const upload = jest.mocked(storeFiles);

  const makeApp = (overrides: Partial<RateLimitSettings>, trustProxy = 0): Express =>
    createApp({ rateLimits: limits(overrides), trustProxy });

  const valid = { ...PROFILE, category: 'shoes', specification_json: SPEC, customer_email: 'buyer@example.com' };
  const post = (app: Express, ip?: string, body: object = valid) => {
    const req = request(app).post('/api/estimates');
    if (ip) {
      req.set('X-Forwarded-For', ip);
    }
    return req.send(body);
  };
  const read = (app: Express, ip?: string) => {
    const req = request(app).get(`/api/estimates/${RECEIPT}`).query({ token: 'a'.repeat(64) });
    if (ip) {
      req.set('X-Forwarded-For', ip);
    }
    return req;
  };

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    create.mockReset().mockResolvedValue(CREATED);
    lookup.mockReset().mockResolvedValue(null);
    upload.mockReset().mockResolvedValue([] as never);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('configuration', () => {
    it('defaults to 10 creations per hour and 30 reads per 15 minutes', () => {
      expect(RATE_LIMIT_DEFAULTS.estimateCreate).toEqual({ windowMs: HOUR, max: 10 });
      expect(RATE_LIMIT_DEFAULTS.estimateRead).toEqual({ windowMs: QUARTER, max: 30 });
    });

    it('is adjustable through the environment', () => {
      const parsed = parseRateLimits({
        CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_WINDOW_MS: '60000',
        CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX: '3',
        CUSTOMER_ESTIMATE_READ_RATE_LIMIT_WINDOW_MS: '120000',
        CUSTOMER_ESTIMATE_READ_RATE_LIMIT_MAX: '7'
      });

      expect(parsed.estimateCreate).toEqual({ windowMs: 60000, max: 3 });
      expect(parsed.estimateRead).toEqual({ windowMs: 120000, max: 7 });
      // The admin limits are untouched.
      expect(parsed.login).toEqual(RATE_LIMIT_DEFAULTS.login);
    });

    it.each([
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX', '0', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX', '100001', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX', '-5', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX', '2.5', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX', 'ten', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_WINDOW_MS', '999', 'between 1000 and 86400000'],
      ['CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_WINDOW_MS', '86400001', 'between 1000 and 86400000'],
      ['CUSTOMER_ESTIMATE_READ_RATE_LIMIT_MAX', '0', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_READ_RATE_LIMIT_MAX', '1e3', 'between 1 and 100000'],
      ['CUSTOMER_ESTIMATE_READ_RATE_LIMIT_WINDOW_MS', '0', 'between 1000 and 86400000'],
      ['CUSTOMER_ESTIMATE_READ_RATE_LIMIT_WINDOW_MS', 'abc', 'between 1000 and 86400000']
    ])('refuses %s=%s at start-up (the error names the variable)', (name, value, range) => {
      expect(() => parseRateLimits({ [name]: value })).toThrow(`${name} must be an integer ${range}`);
    });
  });

  describe('POST /api/estimates (creation)', () => {
    it('allows the budget and then answers 429 with Retry-After and RateLimit headers', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 3 } });

      for (let i = 0; i < 3; i += 1) {
        expect((await post(app)).status).toBe(201);
      }
      const blocked = await post(app);

      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(HOUR / 1000);
      expect(blocked.body.retry_after_seconds).toBe(retryAfter);
      expect(blocked.headers['ratelimit']).toBeDefined();
      expect(blocked.headers['ratelimit-policy']).toBeDefined();
      expect(blocked.headers['cache-control']).toBe('no-store');
    });

    it('refuses before anything is parsed, stored or uploaded: no service, no file, no database', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } });
      await post(app);
      create.mockClear();
      upload.mockClear();
      db.state.queries.length = 0;

      const blocked = await request(app)
        .post('/api/estimates')
        .field('category', 'shoes')
        .field('specification_json', JSON.stringify(SPEC))
        .field('customer_email', 'buyer@example.com')
        .field('customer_type', 'individual_startup')
        .field('customer_name', 'Kim')
        .field('privacy_consent', 'true')
        .field('privacy_consent_version', 'dev-draft')
        .attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

      expect(blocked.status).toBe(429);
      expect(create).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(db.state.queries).toHaveLength(0);
      expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('is mounted before the body parser: an unparseable body is refused with 429, not 400', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } });
      await post(app);

      const res = await request(app)
        .post('/api/estimates')
        .set('Content-Type', 'application/json')
        .send('{"category": ');

      expect(res.status).toBe(429);
    });

    it('counts invalid requests too, so a client cannot probe the validation for free', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 2 } });

      expect((await post(app, undefined, {})).status).toBe(400);
      expect((await post(app, undefined, { category: 'nope' })).status).toBe(400);
      expect((await post(app)).status).toBe(429);
    });

    it('starts a fresh budget when the window has passed', async () => {
      // Only Date is faked: supertest and the sockets keep their real timers.
      jest.useFakeTimers({ now: new Date('2026-10-13T03:00:00Z'), doNotFake: FAKE_ONLY_DATE });
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } });

      expect((await post(app)).status).toBe(201);
      expect((await post(app)).status).toBe(429);

      jest.setSystemTime(new Date('2026-10-13T04:00:01Z'));
      expect((await post(app)).status).toBe(201);
    });
  });

  describe('GET /api/estimates/:receipt_id (reading)', () => {
    it('answers 429 after the budget and does not touch the service or the token again', async () => {
      const app = makeApp({ estimateRead: { windowMs: QUARTER, max: 2 } });

      expect((await read(app)).status).toBe(401);
      expect((await read(app)).status).toBe(401);
      lookup.mockClear();
      const blocked = await read(app);

      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(blocked.headers['ratelimit']).toBeDefined();
      expect(lookup).not.toHaveBeenCalled();
      expect(db.state.queries).toHaveLength(0);
    });

    it('keeps its own budget, separate from creation', async () => {
      const app = makeApp({
        estimateCreate: { windowMs: HOUR, max: 1 },
        estimateRead: { windowMs: QUARTER, max: 1 }
      });

      expect((await post(app)).status).toBe(201);
      expect((await post(app)).status).toBe(429);
      // Reading is not affected by the used-up creation budget.
      expect((await read(app)).status).not.toBe(429);
      expect((await read(app)).status).toBe(429);
    });
  });

  describe('which client IP is used', () => {
    it('behind one trusted proxy every client IP has its own budget', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } }, 1);

      expect((await post(app, '203.0.113.1')).status).toBe(201);
      expect((await post(app, '203.0.113.1')).status).toBe(429);
      expect((await post(app, '203.0.113.2')).status).toBe(201);
    });

    it('with TRUST_PROXY=0 a forged X-Forwarded-For cannot be used to dodge the limit', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } }, 0);

      expect((await post(app, '203.0.113.1')).status).toBe(201);
      expect((await post(app, '203.0.113.2')).status).toBe(429);
      expect((await post(app, '203.0.113.3')).status).toBe(429);
    });

    it('trusts only the configured number of proxies: extra forged entries on the left are ignored', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } }, 1);

      expect((await post(app, '198.51.100.7, 203.0.113.1')).status).toBe(201);
      // Same real client (the entry the proxy added), different forged prefix.
      expect((await post(app, '198.51.100.99, 203.0.113.1')).status).toBe(429);
    });

    it('counts IPv6 clients of one subnet together', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } }, 1);

      expect((await post(app, '2001:db8:1:2::1')).status).toBe(201);
      expect((await post(app, '2001:db8:1:2::ffff')).status).toBe(429);
    });
  });

  describe('exposed to browsers on another origin', () => {
    it('lists Retry-After and the RateLimit headers in Access-Control-Expose-Headers', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 } });
      await post(app);

      const blocked = await post(app).set('Origin', 'http://localhost:3000');

      expect(blocked.status).toBe(429);
      const exposed = String(blocked.headers['access-control-expose-headers']).toLowerCase();
      expect(exposed).toContain('retry-after');
      expect(exposed).toContain('ratelimit');
      expect(exposed).toContain('ratelimit-policy');
    });
  });

  describe('no effect on the admin API or the account lockout', () => {
    it('exhausted public budgets do not limit /admin, /health or the login', async () => {
      const app = makeApp({
        estimateCreate: { windowMs: HOUR, max: 1 },
        estimateRead: { windowMs: QUARTER, max: 1 }
      });
      await post(app);
      await post(app);
      await read(app);
      await read(app);
      db.state.queries.length = 0;

      expect((await request(app).get('/health')).status).toBe(200);
      expect((await request(app).get('/admin/estimates')).status).toBe(401);
      expect((await request(app).post('/admin/login').send({ username: 'master', password: 'x' })).status).toBe(401);
    });

    it('refused public requests never reach the database, so no account counter can move', async () => {
      const app = makeApp({ estimateCreate: { windowMs: HOUR, max: 1 }, estimateRead: { windowMs: QUARTER, max: 1 } });
      await post(app);
      await read(app);
      db.state.queries.length = 0;

      for (let i = 0; i < 5; i += 1) {
        expect((await post(app)).status).toBe(429);
        expect((await read(app)).status).toBe(429);
      }

      expect(db.state.queries).toHaveLength(0);
      expect(db.state.queries.some(q => q.sql.includes('failed_login_attempts'))).toBe(false);
    });

    it('the admin limiters do not count public requests', async () => {
      const app = makeApp({ api: { windowMs: 60_000, max: 1 } });

      for (let i = 0; i < 5; i += 1) {
        expect((await post(app)).status).toBe(201);
      }
      expect((await request(app).get('/admin/nope')).status).not.toBe(429);
    });
  });
});
