jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { ADMIN_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

// Guards the behaviour that existed before the app was split out of index.ts:
// health check, CORS, admin authentication routes and the customer API.
describe('App regression after the app.ts split', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;

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

  describe('health and basics', () => {
    it('GET /health returns ok without touching the database', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.environment).toBe(config.nodeEnv);
      expect(db.state.queries).toHaveLength(0);
    });

    it('returns 404 for unknown routes', async () => {
      expect((await request(app).get('/nope')).status).toBe(404);
      expect((await request(app).get('/admin/nope')).status).toBe(404);
    });

    it('keeps CORS with credentials and allows PATCH for the configured origin', async () => {
      const origin = config.corsOrigins[0];
      const res = await request(app)
        .options('/admin/estimates/x/status')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'PATCH');

      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    });

    it('returns 400 (not 500) for malformed JSON on the customer API', async () => {
      const res = await request(app)
        .post('/api/estimates')
        .set('Content-Type', 'application/json')
        .send('{"category": ');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_JSON');
    });
  });

  describe('admin authentication routes', () => {
    const password = 'Correct-Horse-9';
    const passwordHash = bcrypt.hashSync(password, 4);

    const adminRow = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null
    };

    it('POST /admin/login requires a password and an identifier', async () => {
      expect((await request(app).post('/admin/login').send({ username: 'master' })).status).toBe(400);
      expect((await request(app).post('/admin/login').send({ password })).status).toBe(400);
    });

    it('POST /admin/login rejects unknown users and wrong passwords with 401', async () => {
      const unknown = await request(app).post('/admin/login').send({ username: 'ghost', password });
      expect(unknown.status).toBe(401);

      db.state.handler = sql => (sql.includes('password_hash') ? { rows: [adminRow] } : undefined);
      const wrong = await request(app).post('/admin/login').send({ username: 'master', password: 'wrong-password-1' });

      expect(wrong.status).toBe(401);
      const failedUpdate = db.state.queries.find(q => q.sql.includes('failed_login_attempts = $1'))!;
      expect(failedUpdate.params[0]).toBe(1);
    });

    it('POST /admin/login sets HttpOnly cookies scoped to /admin and returns no secrets', async () => {
      db.state.handler = sql => (sql.includes('password_hash') ? { rows: [adminRow] } : undefined);

      const res = await request(app).post('/admin/login').send({ username: 'master', password });

      expect(res.status).toBe(200);
      expect(res.body.admin).toEqual({
        id: ADMIN_ID,
        username: 'master',
        email: 'admin@bridgepath.local',
        role: 'admin'
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|hash|token/i);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const access = cookies.find(c => c.startsWith('access_token='))!;
      const refresh = cookies.find(c => c.startsWith('refresh_token='))!;
      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/Path=\/admin(;|$)/);
      expect(access).toMatch(/SameSite=Strict/i);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/Path=\/admin\/token\/refresh/);

      expect(db.state.queries.some(q => q.sql.includes('INSERT INTO admin_sessions'))).toBe(true);
    });

    it('POST /admin/logout requires authentication and revokes the session', async () => {
      expect((await request(app).post('/admin/logout')).status).toBe(401);

      const res = await request(app).post('/admin/logout').set('Cookie', authCookie('admin'));

      expect(res.status).toBe(200);
      expect(db.state.queries.some(q => q.sql.includes('is_revoked = true'))).toBe(true);
    });

    it('POST /admin/token/refresh requires both cookies', async () => {
      expect((await request(app).post('/admin/token/refresh')).status).toBe(401);
      expect(
        (await request(app).post('/admin/token/refresh').set('Cookie', authCookie('admin'))).status
      ).toBe(401);
    });
  });

  describe('customer API routes', () => {
    it('GET /api/estimates/:receipt_id keeps its 404 / 401 behaviour', async () => {
      expect((await request(app).get('/api/estimates/not-a-receipt?token=abc')).status).toBe(404);
      expect((await request(app).get('/api/estimates/BP20261013001')).status).toBe(401);

      const wrongToken = await request(app).get('/api/estimates/BP20261013001?token=wrong');
      expect(wrongToken.status).toBe(401);
    });

    it('GET /api/estimates/:receipt_id returns the estimate for a valid token', async () => {
      db.state.handler = sql => {
        if (sql.includes('UPDATE estimate_access_tokens')) {
          return { rows: [{ estimate_id: 'e1' }] };
        }
        if (sql.includes('FROM estimates e')) {
          return {
            rows: [
              {
                receipt_id: 'BP20261013001',
                category: 'eyewear',
                status: 'new_receipt',
                specification_json: { quantity: 10 },
                created_at: new Date('2026-10-13T00:00:00Z'),
                updated_at: new Date('2026-10-13T00:00:00Z')
              }
            ]
          };
        }
        return undefined;
      };

      const res = await request(app).get('/api/estimates/BP20261013001?token=valid-token');

      expect(res.status).toBe(200);
      expect(res.body.receipt_id).toBe('BP20261013001');
      expect(Object.keys(res.body).sort()).toEqual(
        ['category', 'created_at', 'receipt_id', 'specification_json', 'status', 'updated_at']
      );
    });

    it('POST /api/estimates still validates the required fields', async () => {
      const res = await request(app).post('/api/estimates').send({ customer_email: 'a@b.co' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing required field: category');
    });
  });
});
