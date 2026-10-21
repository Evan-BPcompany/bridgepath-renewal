import { Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RateLimitSetting, RateLimitSettings } from '../config/env';

// All counters live in process memory (express-rate-limit's default store): they are per
// server process, reset on restart or deploy, and are not shared between instances. See
// the README before running more than one instance.

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Needs the right TRUST_PROXY setting behind a proxy; otherwise every client looks like the proxy.
function clientKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

// Limits follow the signed-in admin when there is one, and fall back to the client IP.
function adminKey(req: Request): string {
  return req.admin ? `admin:${req.admin.id}` : `ip:${clientKey(req)}`;
}

// express-rate-limit attaches its state to the request as `rateLimit`.
type LimitedRequest = Request & { rateLimit?: { resetTime?: Date } };

function rejectTooManyRequests(req: LimitedRequest, res: Response): void {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfterSeconds = Math.max(
    1,
    resetTime ? Math.ceil((resetTime.getTime() - Date.now()) / 1000) : 1
  );

  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
    retry_after_seconds: retryAfterSeconds,
    timestamp: new Date().toISOString()
  });
}

function build(
  setting: RateLimitSetting,
  options: Parameters<typeof rateLimit>[0] = {}
): RequestHandler {
  return rateLimit({
    windowMs: setting.windowMs,
    limit: setting.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => rejectTooManyRequests(req, res),
    ...options
  });
}

export interface RateLimiters {
  // POST /admin/login: per client IP, counting only failed attempts. Successful logins
  // are not counted, and the per-account lockout (5 failures / 15 minutes) works on its own.
  login: RequestHandler;
  // Everything under /admin (including login and token refresh): per client IP.
  api: RequestHandler;
  // State-changing requests of a signed-in admin (status change, memo creation): per admin.
  mutation: RequestHandler;
  // Password change: per admin.
  password: RequestHandler;
  // Public customer API, per client IP. Every request counts (valid or not, successful or not):
  // creating an estimate parses up to 10 uploaded files and writes to S3 and the database,
  // reading one consumes a one-time token. Mount them before the body parser and before
  // Multer so a refused request costs almost nothing.
  estimateCreate: RequestHandler;
  estimateRead: RequestHandler;
  // POST /api/estimate-preview: a database read per request, so it is limited per client IP too.
  estimatePreview: RequestHandler;
  // POST /api/estimate-preview/analyze-image: every request may cost a paid model call.
  imageAnalysis: RequestHandler;
  // Customer accounts, per client IP. Login counts only failed attempts; the others count every request.
  customerLogin: RequestHandler;
  customerSignup: RequestHandler;
  customerCode: RequestHandler;
  // GET /api/customers/me/estimates...: per client IP.
  customerRead: RequestHandler;
}

export function createRateLimiters(settings: RateLimitSettings): RateLimiters {
  return {
    login: build(settings.login, {
      keyGenerator: clientKey,
      skipSuccessfulRequests: true
    }),
    api: build(settings.api, { keyGenerator: clientKey }),
    mutation: build(settings.mutation, {
      keyGenerator: adminKey,
      skip: req => SAFE_METHODS.includes(req.method)
    }),
    password: build(settings.password, { keyGenerator: adminKey }),
    estimateCreate: build(settings.estimateCreate, { keyGenerator: clientKey }),
    estimateRead: build(settings.estimateRead, { keyGenerator: clientKey }),
    estimatePreview: build(settings.estimatePreview, { keyGenerator: clientKey }),
    imageAnalysis: build(settings.imageAnalysis, { keyGenerator: clientKey }),
    customerLogin: build(settings.customerLogin, { keyGenerator: clientKey, skipSuccessfulRequests: true }),
    customerSignup: build(settings.customerSignup, { keyGenerator: clientKey }),
    customerCode: build(settings.customerCode, { keyGenerator: clientKey }),
    customerRead: build(settings.customerRead, { keyGenerator: clientKey })
  };
}
