import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env';

export interface AccessTokenPayload extends JwtPayload {
  adminUserId: string;
  sessionId: string;
  role: 'admin' | 'manager';
}

export function generateAccessToken(
  adminUserId: string,
  sessionId: string,
  role: 'admin' | 'manager'
): string {
  const payload: AccessTokenPayload = {
    adminUserId,
    sessionId,
    role
  };

  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiration as any
  };

  return jwt.sign(payload, config.jwtSecret, options);
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256']
    }) as AccessTokenPayload;
  } catch (err) {
    throw new Error('Invalid or expired access token');
  }
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
