import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RequestHandler, Request, Response, Router } from 'express';
import { config } from '../config/env';
import { getAcceptedConsentVersions } from '../config/privacyConsent';
import logger from '../utils/logger';
import {
  CODE_RESEND_WAIT_MS,
  SESSION_COOKIE,
  SignupProfile,
  checkPassword,
  isCodeFormat,
  normalizeEmail,
  safeNextPath,
  validateProfile
} from '../utils/customerAccount';
import {
  CustomerAuthError,
  consumeCode,
  createSession,
  findCustomerByEmail,
  issueCode,
  loadPublicCustomer,
  loginWithPassword,
  loginWithSocial,
  markEmailVerified,
  recordConsent,
  revokeSession,
  setPassword,
  signup,
  updateProfile
} from '../services/customerAuthService';
import { CodePurpose, MailUnavailableError, sendCodeEmail } from '../services/customerMailer';
import {
  OAuthError,
  PROVIDERS,
  Provider,
  buildAuthorizeUrl,
  fetchSocialProfile,
  isProvider,
  isProviderEnabled,
  newPkce
} from '../services/oauthProviders';
import { clearSessionCookie, readCustomerSession, requireCustomer, sessionCookieOptions } from '../middleware/customerAuth';

export interface CustomerAuthRouterOptions {
  loginLimiter: RequestHandler;
  signupLimiter: RequestHandler;
  codeLimiter: RequestHandler;
}

interface OAuthState {
  provider: string;
  state: string;
  verifier: string;
  next: string;
}

const OAUTH_COOKIE = 'bp_oauth';
const OAUTH_COOKIE_PATH = '/api/customers/oauth';
const OAUTH_STATE_TTL_SECONDS = 600;

const now = (): string => new Date().toISOString();

function fail(res: Response, status: number, code: string, error: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error, code, ...extra, timestamp: now() });
}

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
}

// A code mail failed: the account exists and the customer may ask again, so say so plainly.
function handleMailFailure(res: Response, err: unknown): void {
  if (!(err instanceof MailUnavailableError)) {
    logger.error('Sending a verification code failed', { error: err instanceof Error ? err.message : String(err) });
  }
  fail(res, 503, 'EMAIL_UNAVAILABLE', 'The e-mail could not be sent. Please try again later.');
}

async function sendNewCode(customerId: string, email: string, purpose: CodePurpose): Promise<void> {
  const code = await issueCode(customerId, purpose);
  await sendCodeEmail(email, purpose, code);
}

function consentVersionOf(res: Response, body: Record<string, unknown>): string | undefined {
  const accepted = getAcceptedConsentVersions(config.nodeEnv);
  if (accepted.length === 0) {
    fail(res, 503, 'PRIVACY_CONSENT_NOT_CONFIGURED', 'Sign-up is not available yet');
    return undefined;
  }
  const version = typeof body.privacy_consent_version === 'string' ? body.privacy_consent_version.trim() : '';
  if (body.privacy_consent !== true || !accepted.includes(version)) {
    res.status(400).json({
      error: 'The privacy consent is required',
      code: 'VALIDATION_ERROR',
      details: [{ field: 'privacy_consent', message: 'must be true, with an accepted privacy_consent_version' }],
      timestamp: now()
    });
    return undefined;
  }
  return version;
}

export function createCustomerAuthRouter(options: CustomerAuthRouterOptions): Router {
  const router = Router();

  const startSession = async (req: Request, res: Response, customerId: string): Promise<void> => {
    const token = await createSession(customerId, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  };

  // ------------------------------------------------------------------ sign-up with an e-mail code

  router.post('/signup', options.signupLimiter, async (req: Request, res: Response) => {
    try {
      const body = bodyOf(req);
      const errors = [];
      const email = normalizeEmail(body.email);
      if (!email) {
        errors.push({ field: 'email', message: 'must be a valid e-mail address' });
      }
      const passwordError = checkPassword(body.password, email);
      if (passwordError) {
        errors.push(passwordError);
      }
      const profile = validateProfile(body, { nameRequired: true });
      if (!profile.valid) {
        errors.push(...profile.errors);
      }
      if (errors.length > 0 || !email || !profile.valid) {
        res.status(400).json({ error: 'Invalid sign-up information', code: 'VALIDATION_ERROR', details: errors, timestamp: now() });
        return;
      }

      const consentVersion = consentVersionOf(res, body);
      if (!consentVersion) {
        return;
      }

      const { customerId } = await signup({
        email,
        password: body.password as string,
        profile: profile.value as SignupProfile,
        consentVersion
      });
      try {
        await sendNewCode(customerId, email, 'signup');
      } catch (err) {
        if (err instanceof CustomerAuthError && err.code === 'CODE_TOO_SOON') {
          fail(res, 429, 'CODE_TOO_SOON', 'Please wait before asking for a new code', { retry_after_seconds: err.retryAfterSeconds });
        } else {
          handleMailFailure(res, err);
        }
        return;
      }

      res.status(201).json({
        message: 'A verification code was sent',
        email,
        resend_after_seconds: CODE_RESEND_WAIT_MS / 1000,
        timestamp: now()
      });
    } catch (err) {
      if (err instanceof CustomerAuthError && err.code === 'EMAIL_TAKEN') {
        fail(res, 409, 'EMAIL_TAKEN', 'This e-mail is already registered');
      } else {
        logger.error('Customer sign-up error', { error: err instanceof Error ? err.message : String(err) });
        fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
      }
    }
  });

  router.post('/verify-email', options.codeLimiter, async (req: Request, res: Response) => {
    try {
      const body = bodyOf(req);
      const email = normalizeEmail(body.email);
      if (!email || !isCodeFormat(body.code)) {
        fail(res, 400, 'INVALID_CODE', 'The code is not right');
        return;
      }

      const customer = await findCustomerByEmail(email);
      if (!customer || !customer.active) {
        fail(res, 400, 'INVALID_CODE', 'The code is not right');
        return;
      }

      await consumeCode(customer.id, 'signup', body.code);
      await markEmailVerified(customer.id);
      await startSession(req, res, customer.id);
      res.json({ customer: await loadPublicCustomer(customer.id), timestamp: now() });
    } catch (err) {
      if (err instanceof CustomerAuthError) {
        const messages: Record<string, string> = {
          INVALID_CODE: 'The code is not right',
          CODE_EXPIRED: 'The code has expired. Please ask for a new one.',
          TOO_MANY_ATTEMPTS: 'Too many wrong codes. Please ask for a new one.'
        };
        if (messages[err.code]) {
          fail(res, 400, err.code, messages[err.code]);
          return;
        }
      }
      logger.error('Customer e-mail verification error', { error: err instanceof Error ? err.message : String(err) });
      fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  // The answer is the same whether or not the e-mail has an unverified account.
  router.post('/resend-code', options.codeLimiter, async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(bodyOf(req).email);
      if (!email) {
        fail(res, 400, 'VALIDATION_ERROR', 'A valid e-mail address is required');
        return;
      }
      const customer = await findCustomerByEmail(email);
      if (customer && customer.active && !customer.verified) {
        try {
          await sendNewCode(customer.id, email, 'signup');
        } catch (err) {
          if (!(err instanceof CustomerAuthError && err.code === 'CODE_TOO_SOON')) {
            throw err;
          }
        }
      }
      res.json({ message: 'If a code is due it was sent', resend_after_seconds: CODE_RESEND_WAIT_MS / 1000, timestamp: now() });
    } catch (err) {
      handleMailFailure(res, err);
    }
  });

  // ------------------------------------------------------------------ password login

  router.post('/login', options.loginLimiter, async (req: Request, res: Response) => {
    try {
      const body = bodyOf(req);
      const email = normalizeEmail(body.email);
      if (!email || typeof body.password !== 'string' || body.password === '') {
        fail(res, 400, 'VALIDATION_ERROR', 'E-mail and password are required');
        return;
      }

      const { customerId } = await loginWithPassword(email, body.password);
      await startSession(req, res, customerId);
      res.json({ customer: await loadPublicCustomer(customerId), timestamp: now() });
    } catch (err) {
      if (err instanceof CustomerAuthError) {
        if (err.code === 'INVALID_CREDENTIALS') {
          fail(res, 401, 'INVALID_CREDENTIALS', 'The e-mail or the password is not right');
          return;
        }
        if (err.code === 'ACCOUNT_LOCKED') {
          fail(res, 429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Please try again later.');
          return;
        }
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          // Send a fresh code so the screen can go straight to the code step.
          const email = normalizeEmail(bodyOf(req).email);
          const customer = email ? await findCustomerByEmail(email).catch(() => undefined) : undefined;
          if (email && customer) {
            await sendNewCode(customer.id, email, 'signup').catch(() => undefined);
          }
          fail(res, 403, 'EMAIL_NOT_VERIFIED', 'The e-mail has not been verified yet');
          return;
        }
      }
      logger.error('Customer login error', { error: err instanceof Error ? err.message : String(err) });
      fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
        await revokeSession(token);
      }
    } catch (err) {
      logger.error('Customer logout error', { error: err instanceof Error ? err.message : String(err) });
    }
    clearSessionCookie(res);
    res.json({ message: 'Signed out', timestamp: now() });
  });

  // ------------------------------------------------------------------ password reset

  router.post('/password-reset/request', options.codeLimiter, async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(bodyOf(req).email);
      if (!email) {
        fail(res, 400, 'VALIDATION_ERROR', 'A valid e-mail address is required');
        return;
      }
      const customer = await findCustomerByEmail(email);
      if (customer && customer.active) {
        try {
          await sendNewCode(customer.id, email, 'password_reset');
        } catch (err) {
          if (!(err instanceof CustomerAuthError && err.code === 'CODE_TOO_SOON')) {
            throw err;
          }
        }
      }
      res.json({ message: 'If the account exists a code was sent', resend_after_seconds: CODE_RESEND_WAIT_MS / 1000, timestamp: now() });
    } catch (err) {
      handleMailFailure(res, err);
    }
  });

  router.post('/password-reset/confirm', options.codeLimiter, async (req: Request, res: Response) => {
    try {
      const body = bodyOf(req);
      const email = normalizeEmail(body.email);
      if (!email || !isCodeFormat(body.code)) {
        fail(res, 400, 'INVALID_CODE', 'The code is not right');
        return;
      }
      const passwordError = checkPassword(body.new_password, email);
      if (passwordError) {
        res.status(400).json({
          error: 'Invalid password',
          code: 'VALIDATION_ERROR',
          details: [{ ...passwordError, field: 'new_password' }],
          timestamp: now()
        });
        return;
      }

      const customer = await findCustomerByEmail(email);
      if (!customer || !customer.active) {
        fail(res, 400, 'INVALID_CODE', 'The code is not right');
        return;
      }
      await consumeCode(customer.id, 'password_reset', body.code);
      await setPassword(customer.id, body.new_password as string);
      res.json({ message: 'The password was changed', timestamp: now() });
    } catch (err) {
      if (err instanceof CustomerAuthError && ['INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(err.code)) {
        fail(res, 400, err.code, 'The code is not right, or it has expired');
        return;
      }
      logger.error('Customer password reset error', { error: err instanceof Error ? err.message : String(err) });
      fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  // ------------------------------------------------------------------ the signed-in customer

  router.get('/me', readCustomerSession, (req: Request, res: Response) => {
    if (!req.customer) {
      fail(res, 401, 'CUSTOMER_AUTH_REQUIRED', 'Sign in required');
      return;
    }
    res.json({ customer: req.customer, timestamp: now() });
  });

  router.patch('/me', requireCustomer, async (req: Request, res: Response) => {
    try {
      const profile = validateProfile(bodyOf(req), { nameRequired: false });
      if (!profile.valid) {
        res.status(400).json({ error: 'Invalid profile', code: 'VALIDATION_ERROR', details: profile.errors, timestamp: now() });
        return;
      }
      res.json({ customer: await updateProfile(req.customer!.id, profile.value), timestamp: now() });
    } catch (err) {
      logger.error('Customer profile update error', { error: err instanceof Error ? err.message : String(err) });
      fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  // For an account made with Google or Kakao, which has not seen the consent text yet.
  router.post('/me/consent', requireCustomer, async (req: Request, res: Response) => {
    try {
      const version = consentVersionOf(res, bodyOf(req));
      if (!version) {
        return;
      }
      await recordConsent(req.customer!.id, version);
      res.json({ customer: await loadPublicCustomer(req.customer!.id), timestamp: now() });
    } catch (err) {
      logger.error('Customer consent error', { error: err instanceof Error ? err.message : String(err) });
      fail(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  // ------------------------------------------------------------------ Google / Kakao

  router.get('/oauth/providers', (_req: Request, res: Response) => {
    const enabled: Record<string, boolean> = {};
    for (const provider of PROVIDERS) {
      enabled[provider] = isProviderEnabled(provider);
    }
    res.json({ providers: enabled, timestamp: now() });
  });

  // Where the browser goes when something goes wrong: the login page with a fixed code, never a message.
  const backToLogin = (res: Response, error: string, next: string): void => {
    const url = new URL('/login.html', config.frontendBaseUrl);
    url.searchParams.set('error', error);
    if (next !== '/') {
      url.searchParams.set('next', next);
    }
    res.redirect(url.toString());
  };

  const clearOAuthCookie = (res: Response): void => {
    res.clearCookie(OAUTH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: OAUTH_COOKIE_PATH });
  };

  router.get('/oauth/:provider/start', options.loginLimiter, (req: Request, res: Response) => {
    const next = safeNextPath(req.query.next);
    const provider = req.params.provider;
    if (!isProvider(provider) || !isProviderEnabled(provider)) {
      backToLogin(res, 'provider_unavailable', next);
      return;
    }

    const state = crypto.randomBytes(24).toString('base64url');
    const pkce = newPkce();
    const cookie = jwt.sign({ provider, state, verifier: pkce.verifier, next }, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: OAUTH_STATE_TTL_SECONDS
    });
    res.cookie(OAUTH_COOKIE, cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_STATE_TTL_SECONDS * 1000
    });
    res.redirect(buildAuthorizeUrl(provider as Provider, state, pkce.challenge));
  });

  router.get('/oauth/:provider/callback', options.loginLimiter, async (req: Request, res: Response) => {
    let next = '/';
    try {
      const provider = req.params.provider;
      let saved: OAuthState | undefined;
      try {
        saved = jwt.verify(String(req.cookies?.[OAUTH_COOKIE] ?? ''), config.jwtSecret, { algorithms: ['HS256'] }) as unknown as OAuthState;
      } catch {
        saved = undefined;
      }
      clearOAuthCookie(res);
      next = safeNextPath(saved?.next);

      if (!isProvider(provider) || !isProviderEnabled(provider)) {
        backToLogin(res, 'provider_unavailable', next);
        return;
      }
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const stateMatches =
        saved !== undefined &&
        saved.provider === provider &&
        state.length === saved.state.length &&
        crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state));
      if (!stateMatches || !saved) {
        backToLogin(res, 'state_invalid', next);
        return;
      }
      if (typeof req.query.error === 'string' || typeof req.query.code !== 'string' || req.query.code === '') {
        backToLogin(res, 'cancelled', next);
        return;
      }

      const profile = await fetchSocialProfile(provider, req.query.code, saved.verifier);
      const { customerId } = await loginWithSocial(profile);
      await startSession(req, res, customerId);

      const customer = await loadPublicCustomer(customerId);
      const target = new URL(customer?.consent_required ? '/login.html' : next, config.frontendBaseUrl);
      if (customer?.consent_required) {
        target.searchParams.set('step', 'consent');
        if (next !== '/') {
          target.searchParams.set('next', next);
        }
      }
      res.redirect(target.toString());
    } catch (err) {
      if (err instanceof OAuthError) {
        backToLogin(res, err.code.toLowerCase(), next);
        return;
      }
      if (err instanceof CustomerAuthError) {
        backToLogin(res, 'account_blocked', next);
        return;
      }
      logger.error('Social login error', { error: err instanceof Error ? err.message : String(err) });
      backToLogin(res, 'provider_error', next);
    }
  });

  return router;
}
