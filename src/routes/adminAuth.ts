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
import { allowPasswordChangeRequired, authMiddleware } from '../middleware/auth';
import { evaluateLockout, nextFailureState } from '../utils/loginLockout';
import { randomUUID } from 'crypto';

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
      `SELECT id, username, email, password_hash, role, is_active, failed_login_attempts, locked_until,
              must_change_password
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
    const lockout = evaluateLockout(admin, now);

    if (lockout.status === 'locked') {
      res.status(401).json({ error: 'Account is locked. Try again later.' });
      return;
    }

    if (lockout.status === 'expired') {
      // The lock has run out: start counting from zero instead of re-locking on the next typo.
      await pool.query(
        `UPDATE admin_users
         SET failed_login_attempts = 0, locked_until = NULL
         WHERE id = $1`,
        [admin.id]
      );
    }

    const passwordMatch = await comparePassword(password, admin.password_hash);

    if (!passwordMatch) {
      const failure = nextFailureState(lockout.attempts, now);

      await pool.query(
        `UPDATE admin_users
         SET failed_login_attempts = $1, locked_until = $2
         WHERE id = $3`,
        [failure.failed_login_attempts, failure.locked_until, admin.id]
      );

      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const sessionId = randomUUID();
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
        role: admin.role,
        must_change_password: admin.must_change_password === true
      }
    });
  } catch (err) {
    logger.error('Login error', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// The refresh token is an opaque random value, so the session is found by its hash. The access
// token is deliberately not used here: it is usually already expired when a client refreshes.
const REFRESH_TOKEN_FORMAT = /^[a-f0-9]{64}$/;

router.post('/token/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      res.status(401).json({ error: 'No refresh token provided' });
      return;
    }

    if (typeof refreshToken !== 'string' || !REFRESH_TOKEN_FORMAT.test(refreshToken)) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const pool = getPool();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const sessionResult = await pool.query(
      `SELECT s.id, s.admin_user_id, s.is_revoked, s.expires_at, u.role, u.is_active
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.refresh_token_hash = $1`,
      [refreshTokenHash]
    );

    if (sessionResult.rows.length === 0) {
      res.status(401).json({ error: 'Invalid refresh token' });
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

    if (!session.is_active) {
      res.status(401).json({ error: 'Admin account is inactive' });
      return;
    }

    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    const newAccessToken = generateAccessToken(session.admin_user_id, session.id, session.role);

    // Rotation in one statement: it only succeeds while the presented token is still the
    // current one, so two parallel refreshes cannot both win.
    const rotated = await pool.query(
      `UPDATE admin_sessions
       SET refresh_token_hash = $1, last_activity_at = $2
       WHERE id = $3 AND refresh_token_hash = $4 AND is_revoked = false AND expires_at > $2`,
      [newRefreshTokenHash, new Date(), session.id, refreshTokenHash]
    );

    if (rotated.rowCount === 0) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
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
});

router.post('/logout', allowPasswordChangeRequired, authMiddleware, async (req: Request, res: Response): Promise<void> => {
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
