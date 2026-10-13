jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { authCookie, createFakeDb } from './helpers/adminTestUtils';

describe('security headers', () => {
  let app: Express;

  beforeEach(() => {
    const db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes X-Powered-By everywhere, including 401s and 404s', async () => {
    for (const path of ['/health', '/admin/estimates', '/nope', '/api/estimates/x']) {
      const res = await request(app).get(path);
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('sets the helmet defaults', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sends Cache-Control: no-store on admin responses, success and failure', async () => {
    const unauthenticated = await request(app).get('/admin/estimates');
    const authenticated = await request(app).get('/admin/estimates').set('Cookie', authCookie('admin'));
    const login = await request(app).post('/admin/login').send({});
    const notFound = await request(app).get('/admin/nope');

    for (const res of [unauthenticated, authenticated, login, notFound]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('sends Cache-Control: no-store on customer API responses (they carry personal data)', async () => {
    const res = await request(app).get('/api/estimates/BP20261013001');

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('also protects rate-limited responses', async () => {
    const limited = createApp({ rateLimits: { api: { windowMs: 60_000, max: 1 } } });
    await request(limited).get('/admin/nope');
    const res = await request(limited).get('/admin/nope');

    expect(res.status).toBe(429);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
