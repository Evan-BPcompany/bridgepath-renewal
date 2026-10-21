import { CookieOptions, NextFunction, Request, Response } from 'express';
import { config } from '../config/env';
import logger from '../utils/logger';
import { SESSION_COOKIE, SESSION_TTL_MS, isSessionTokenFormat } from '../utils/customerAccount';
import { PublicCustomer, findSessionCustomer } from '../services/customerAuthService';

declare global {
  namespace Express {
    interface Request {
      customer?: PublicCustomer;
      customerSessionId?: string;
    }
  }
}

// SameSite=Lax, not Strict: a link from an e-mail or from the Google/Kakao page is a navigation from
// another site and must still arrive signed in. Lax cookies are not sent on cross-site POSTs, so
// the JSON API stays safe from forged requests. The customer pages and the API must be the same
// "site" (for example www.example.com and api.example.com); see the README.
export function sessionCookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/api', maxAge: SESSION_TTL_MS };
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/api' });
}

// Reads the session cookie on a route that works with or without a signed-in customer.
export async function readCustomerSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (isSessionTokenFormat(token)) {
    try {
      const found = await findSessionCustomer(token);
      if (found) {
        req.customer = found.customer;
        req.customerSessionId = found.sessionId;
      }
    } catch (err) {
      logger.error('Customer session lookup failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  next();
}

// The route needs a signed-in customer; everything after it may use req.customer.
export async function requireCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
  await readCustomerSession(req, res, () => undefined);
  if (!req.customer) {
    res.status(401).json({
      error: 'Sign in required',
      code: 'CUSTOMER_AUTH_REQUIRED',
      timestamp: new Date().toISOString()
    });
    return;
  }
  next();
}
