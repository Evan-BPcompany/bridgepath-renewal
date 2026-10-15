jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { generateRefreshToken, hashRefreshToken } from '../utils/token';
import { ADMIN_ID, SESSION_ID, authCookie, createFakeDb } from './helpers/adminTestUtils';

const DAY = 24 * 60 * 60 * 1000;

describe('POST /admin/token/refresh', () => {
  let app: Express;
  let db: ReturnType<typeof createFakeDb>;
  let session: Record<string, unknown>;
  let refreshToken: string;
  // Set to false to simulate another request that rotated the token between our read and our update.
  let updateMatches: boolean;
  // What the locked read (FOR SHARE) returns when the account changed after the first read.
  let roleUnderLock: string | undefined;
  let activeUnderLock: boolean | undefined;

  const refresh = (cookie?: string) => {
    const req = request(app).post('/admin/token/refresh');
    return cookie === undefined ? req : req.set('Cookie', cookie);
  };

  const expiredAccessToken = () =>
    jwt.sign({ adminUserId: ADMIN_ID, sessionId: SESSION_ID, role: 'admin' }, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: -60
    });

  const cookiesOf = (res: request.Response) => (res.headers['set-cookie'] ?? []) as unknown as string[];

  const valueOf = (cookies: string[], name: string) =>
    cookies.find(c => c.startsWith(`${name}=`))!.split(';')[0].split('=')[1];

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    app = createApp();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);

    refreshToken = generateRefreshToken();
    updateMatches = true;
    roleUnderLock = undefined;
    activeUnderLock = undefined;
    session = {
      id: SESSION_ID,
      admin_user_id: ADMIN_ID,
      is_revoked: false,
      expires_at: new Date(Date.now() + 10 * DAY),
      role: 'admin',
      is_active: true,
      refresh_token_hash: hashRefreshToken(refreshToken)
    };

    db.state.handler = (sql, params) => {
      if (sql.includes('s.refresh_token_hash = $1')) {
        return params[0] === session.refresh_token_hash ? { rows: [{ ...session }] } : { rows: [] };
      }
      if (sql.includes('FROM admin_users WHERE id = $1 FOR SHARE')) {
        return {
          rows: [{ role: roleUnderLock ?? session.role, is_active: activeUnderLock ?? session.is_active }]
        };
      }
      if (sql.includes('UPDATE admin_sessions') && sql.includes('SET refresh_token_hash')) {
        if (updateMatches && params[3] === session.refresh_token_hash) {
          session.refresh_token_hash = params[0];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('success', () => {
    it('refreshes with only the refresh token cookie (no access token at all)', async () => {
      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Token refreshed successfully' });
    });

    it('refreshes when the access token has really expired', async () => {
      const cookie = `access_token=${expiredAccessToken()}; refresh_token=${refreshToken}`;

      // The expired access token is rejected by the API...
      expect((await request(app).get('/admin/estimates').set('Cookie', cookie)).status).toBe(401);

      // ...but it does not matter for the refresh.
      const res = await refresh(cookie);
      expect(res.status).toBe(200);

      const payload = jwt.verify(valueOf(cookiesOf(res), 'access_token'), config.jwtSecret) as jwt.JwtPayload;
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.adminUserId).toBe(ADMIN_ID);
      expect(payload.role).toBe('admin');
    });

    it('refreshes when the access token is garbage or forged', async () => {
      const forged = jwt.sign({ adminUserId: ADMIN_ID, sessionId: SESSION_ID, role: 'admin' }, 'wrong-secret');

      expect((await refresh(`access_token=garbage; refresh_token=${refreshToken}`)).status).toBe(200);
      session.refresh_token_hash = hashRefreshToken(refreshToken);
      expect((await refresh(`access_token=${forged}; refresh_token=${refreshToken}`)).status).toBe(200);
    });

    it('rotates the refresh token: new cookies, new hash stored, old token dead', async () => {
      const res = await refresh(`refresh_token=${refreshToken}`);

      const cookies = cookiesOf(res);
      const newRefresh = cookies.find(c => c.startsWith('refresh_token='))!;
      const newRefreshValue = valueOf(cookies, 'refresh_token');

      expect(newRefreshValue).toMatch(/^[a-f0-9]{64}$/);
      expect(newRefreshValue).not.toBe(refreshToken);
      expect(newRefresh).toMatch(/HttpOnly/i);
      expect(newRefresh).toMatch(/SameSite=Strict/i);
      expect(newRefresh).toMatch(/Path=\/admin\/token\/refresh/);
      expect(cookies.find(c => c.startsWith('access_token='))).toMatch(/Path=\/admin(;|$)/);

      // Only the hash is stored, never the token itself.
      expect(session.refresh_token_hash).toBe(hashRefreshToken(newRefreshValue));
      expect(JSON.stringify(db.state.queries)).not.toContain(newRefreshValue);
      expect(JSON.stringify(db.state.queries)).not.toContain(refreshToken);

      // The old token no longer works; the new one does.
      expect((await refresh(`refresh_token=${refreshToken}`)).status).toBe(401);
      expect((await refresh(`refresh_token=${newRefreshValue}`)).status).toBe(200);
    });

    it('does not expose tokens or hashes in the body', async () => {
      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(JSON.stringify(res.body)).not.toMatch(/hash|[a-f0-9]{32}|eyJ/);
    });

    it('takes the role from the database, not from any cookie', async () => {
      session.role = 'manager';
      const adminAccess = authCookie('admin').split('=')[1];

      const res = await refresh(`access_token=${adminAccess}; refresh_token=${refreshToken}`);

      const payload = jwt.verify(valueOf(cookiesOf(res), 'access_token'), config.jwtSecret) as jwt.JwtPayload;
      expect(payload.role).toBe('manager');
    });
  });

  describe('missing or invalid refresh token', () => {
    it('401 without any cookie, and the database is not touched', async () => {
      const res = await refresh();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No refresh token provided');
      expect(db.state.queries).toHaveLength(0);
    });

    it('401 with only an access token', async () => {
      const res = await refresh(authCookie('admin'));

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No refresh token provided');
    });

    it.each([
      ['too short', 'abc123'],
      ['not hex', 'z'.repeat(64)],
      ['too long', 'a'.repeat(65)],
      ['an access-token-looking value', 'eyJhbGciOiJIUzI1NiJ9.e30.abc']
    ])('401 for a malformed refresh token (%s) without a database lookup', async (_name, value) => {
      const res = await refresh(`refresh_token=${value}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid refresh token');
      expect(db.state.queries).toHaveLength(0);
    });

    it('401 for a well-formed token that belongs to no session', async () => {
      const res = await refresh(`refresh_token=${generateRefreshToken()}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid refresh token');
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_sessions'))).toBe(false);
      expect(cookiesOf(res)).toHaveLength(0);
    });

    it('401 for a JSON-looking cookie value (cookie-parser turns j: values into objects)', async () => {
      const res = await refresh(`refresh_token=j:{"a":1}`);

      expect(res.status).toBe(401);
      expect(db.state.queries).toHaveLength(0);
    });
  });

  describe('sessions that must not refresh', () => {
    it('401 for a revoked session, with no new cookies and no rotation', async () => {
      session.is_revoked = true;

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has been revoked');
      expect(cookiesOf(res)).toHaveLength(0);
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_sessions'))).toBe(false);
    });

    it('401 for an expired session', async () => {
      session.expires_at = new Date(Date.now() - 1000);

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session has expired');
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_sessions'))).toBe(false);
    });

    it('401 for an inactive admin account', async () => {
      session.is_active = false;

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Admin account is inactive');
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_sessions'))).toBe(false);
    });

    it('401 when another request rotated the token first (lost race), without new cookies', async () => {
      updateMatches = false;

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(cookiesOf(res)).toHaveLength(0);
    });

    it('the rotation only matches the current hash of a live session', async () => {
      await refresh(`refresh_token=${refreshToken}`);

      const update = db.state.queries.find(q => q.sql.includes('SET refresh_token_hash'))!;
      expect(update.sql).toContain('refresh_token_hash = $4');
      expect(update.sql).toContain('is_revoked = false');
      expect(update.sql).toContain('expires_at >');
      expect(update.params[3]).toBe(hashRefreshToken(refreshToken));
    });
  });

  describe('the account is looked at again under a row lock (deactivation race)', () => {
    const statements = () => db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());

    it('locks the user row FOR SHARE before rotating, in one transaction', async () => {
      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(200);
      const order = statements();
      expect(order[0]).toBe('BEGIN');
      expect(order[1]).toBe('SELECT role, is_active FROM admin_users WHERE id = $1 FOR SHARE');
      expect(order[2]).toContain('UPDATE admin_sessions');
      expect(order[3]).toBe('COMMIT');
      expect(order).toHaveLength(4);
      expect(db.pool.connect).toHaveBeenCalledTimes(1);
      expect(db.client.release).toHaveBeenCalledTimes(1);
      // A shared lock: parallel refreshes must not wait for each other.
      expect(order.join('\n')).not.toContain('FOR UPDATE');
    });

    it('locks the user of the session that was found', async () => {
      await refresh(`refresh_token=${refreshToken}`);

      const lock = db.client.query.mock.calls.find(call => String(call[0]).includes('FOR SHARE'))!;
      expect(lock[1]).toEqual([ADMIN_ID]);
    });

    it('401 when the account was deactivated after the first read: no rotation, no cookies, rolled back', async () => {
      // The first read still sees an active account; the locked read sees the deactivation.
      activeUnderLock = false;

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Admin account is inactive');
      expect(cookiesOf(res)).toHaveLength(0);
      expect(session.refresh_token_hash).toBe(hashRefreshToken(refreshToken));
      expect(db.state.queries.some(q => q.sql.includes('UPDATE admin_sessions'))).toBe(false);
      expect(statements()).toEqual([
        'BEGIN',
        'SELECT role, is_active FROM admin_users WHERE id = $1 FOR SHARE',
        'ROLLBACK'
      ]);
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('401 when the user row has disappeared', async () => {
      db.state.handler = sql => {
        if (sql.includes('s.refresh_token_hash = $1')) {
          return { rows: [{ ...session }] };
        }
        if (sql.includes('FOR SHARE')) {
          return { rows: [] };
        }
        return undefined;
      };

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(cookiesOf(res)).toHaveLength(0);
    });

    it('the role in the new access token is the one read under the lock', async () => {
      session.role = 'admin';
      roleUnderLock = 'manager';

      const res = await refresh(`refresh_token=${refreshToken}`);

      const payload = jwt.verify(valueOf(cookiesOf(res), 'access_token'), config.jwtSecret) as jwt.JwtPayload;
      expect(payload.role).toBe('manager');
    });

    it('keeps the compare-and-swap: a lost race is rolled back with 401 and no cookies', async () => {
      updateMatches = false;

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid refresh token');
      expect(cookiesOf(res)).toHaveLength(0);
      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
    });

    it.each([
      ['a revoked session', { is_revoked: true }],
      ['an expired session', { expires_at: new Date(Date.now() - 1000) }],
      ['an account that is already inactive', { is_active: false }]
    ])('does not open a transaction for %s', async (_name, change) => {
      Object.assign(session, change);

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(401);
      expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('rolls back, releases the connection and answers 500 when a query inside the transaction fails', async () => {
      const original = db.state.handler;
      db.state.handler = (sql, params) => {
        if (sql.includes('FOR SHARE')) {
          throw new Error('deadlock detected on 10.0.0.5');
        }
        return original(sql, params);
      };

      const res = await refresh(`refresh_token=${refreshToken}`);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
      expect(statements()).toContain('ROLLBACK');
      expect(db.client.release).toHaveBeenCalledTimes(1);
      expect(cookiesOf(res)).toHaveLength(0);
    });
  });

  it('returns 500 without leaking details when the database fails', async () => {
    db.pool.query.mockRejectedValueOnce(new Error('connection refused to 10.0.0.5'));

    const res = await refresh(`refresh_token=${refreshToken}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
