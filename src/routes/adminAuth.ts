import { Router, Request, Response } from 'express';
import { getPool } from '../config/database';
import { config } from '../config/env';
import logger from '../utils/logger';
import { comparePassword } from '../utils/hash';
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken
} from '../utils/token';
import { authMiddleware } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: config.cookieSecure,
  path: '/admin'
};

interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
}

router.post('/login', async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    if (!username && !email) {
      res.status(400).json({ error: 'Username or email is required' });
      return;
    }

    const pool = getPool();

    const adminResult = await pool.query(
      `SELECT id, username, email, password_hash, role, is_active, failed_login_attempts, locked_until
       FROM admin_users
       WHERE ${username ? 'username = $1' : 'email = $1'}`,
      [username || email]
    );

    if (adminResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const admin = adminResult.rows[0];

    if (!admin.is_active) {
      res.status(401).json({ error: 'Admin account is inactive' });
      return;
    }

    const now = new Date();
    if (admin.locked_until && new Date(admin.locked_until) > now) {
      res.status(401).json({ error: 'Account is locked. Try again later.' });
      return;
    }

    const passwordMatch = await comparePassword(password, admin.password_hash);

    if (!passwordMatch) {
      const newFailedAttempts = admin.failed_login_attempts + 1;
      let lockedUntil = null;

      if (newFailedAttempts >= 5) {
        lockedUntil = new Date(now.getTime() + 15 * 60 * 1000);
      }

      await pool.query(
        `UPDATE admin_users
         SET failed_login_attempts = $1, locked_until = $2
         WHERE id = $3`,
        [newFailedAttempts, lockedUntil, admin.id]
      );

      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const sessionId = uuidv4();
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const accessToken = generateAccessToken(admin.id, sessionId, admin.role);
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO admin_sessions (
          id, admin_user_id, refresh_token_hash, access_token_hash, is_revoked,
          device_info, ip_address, last_activity_at, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          sessionId,
          admin.id,
          refreshTokenHash,
          null,
          false,
          req.get('user-agent'),
          req.ip,
          now,
          now,
          expiresAt
        ]
      );

      await client.query(
        `UPDATE admin_users
         SET failed_login_attempts = 0, locked_until = null
         WHERE id = $1`,
        [admin.id]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.cookie('access_token', accessToken, COOKIE_OPTIONS);
    res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTIONS, path: '/admin/token/refresh' });

    res.json({
      message: 'Login successful',
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (err) {
    logger.error('Login error', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/token/refresh',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const refreshToken = req.cookies.refresh_token;
      const accessToken = req.cookies.access_token;

      if (!refreshToken) {
        res.status(401).json({ error: 'No refresh token provided' });
        return;
      }

      if (!accessToken) {
        res.status(401).json({ error: 'No access token provided' });
        return;
      }

      let payload;
      try {
        payload = verifyAccessToken(accessToken);
      } catch {
        payload = null;
      }

      if (!payload) {
        res.status(401).json({ error: 'Invalid access token' });
        return;
      }

      const pool = getPool();

      const sessionResult = await pool.query(
        `SELECT is_revoked, expires_at, admin_user_id FROM admin_sessions WHERE id = $1`,
        [payload.sessionId]
      );

      if (sessionResult.rows.length === 0) {
        res.status(401).json({ error: 'Session not found' });
        return;
      }

      const session = sessionResult.rows[0];

      if (session.is_revoked) {
        res.status(401).json({ error: 'Session has been revoked' });
        return;
      }

      if (new Date(session.expires_at) < new Date()) {
        res.status(401).json({ error: 'Session has expired' });
        return;
      }

      const refreshTokenHash = hashRefreshToken(refreshToken);
      const storedHashResult = await pool.query(
        `SELECT refresh_token_hash FROM admin_sessions WHERE id = $1`,
        [payload.sessionId]
      );

      if (storedHashResult.rows.length === 0) {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      if (storedHashResult.rows[0].refresh_token_hash !== refreshTokenHash) {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      const newRefreshToken = generateRefreshToken();
      const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
      const newAccessToken = generateAccessToken(
        session.admin_user_id,
        payload.sessionId,
        payload.role
      );
      const now = new Date();

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `UPDATE admin_sessions
           SET refresh_token_hash = $1, last_activity_at = $2
           WHERE id = $3`,
          [newRefreshTokenHash, now, payload.sessionId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      res.cookie('access_token', newAccessToken, COOKIE_OPTIONS);
      res.cookie('refresh_token', newRefreshToken, { ...COOKIE_OPTIONS, path: '/admin/token/refresh' });

      res.json({ message: 'Token refreshed successfully' });
    } catch (err) {
      logger.error('Token refresh error', {
        error: err instanceof Error ? err.message : String(err)
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post('/logout', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      res.status(401).json({ error: 'No access token provided' });
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(accessToken);
    } catch (err) {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }

    const pool = getPool();

    await pool.query(
      `UPDATE admin_sessions SET is_revoked = true WHERE id = $1`,
      [payload.sessionId]
    );

    res.clearCookie('access_token', { path: '/admin' });
    res.clearCookie('refresh_token', { path: '/admin/token/refresh' });

    res.json({ message: 'Logout successful' });
  } catch (err) {
    logger.error('Logout error', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
