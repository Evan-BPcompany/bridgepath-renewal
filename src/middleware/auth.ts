import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, AccessTokenPayload } from '../utils/token';
import { getPool } from '../config/database';
import logger from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        username: string;
        email: string;
        role: 'admin' | 'manager';
      };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const accessToken = req.cookies.access_token;

    if (!accessToken) {
      res.status(401).json({ error: 'No access token provided' });
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(accessToken);
    } catch (err) {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    const pool = getPool();

    const sessionResult = await pool.query(
      `SELECT is_revoked, expires_at FROM admin_sessions WHERE id = $1`,
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

    const adminResult = await pool.query(
      `SELECT id, username, email, role, is_active FROM admin_users WHERE id = $1`,
      [payload.adminUserId]
    );

    if (adminResult.rows.length === 0) {
      res.status(401).json({ error: 'Admin user not found' });
      return;
    }

    const admin = adminResult.rows[0];

    if (!admin.is_active) {
      res.status(401).json({ error: 'Admin account is inactive' });
      return;
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware error', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function requireRole(role: 'admin' | 'manager') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.admin.role !== role && req.admin.role !== 'admin') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
