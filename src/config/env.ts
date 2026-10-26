import dotenv from 'dotenv';
import { DatabaseSsl, resolveDatabaseSsl } from '../db/connectionSafety';

dotenv.config();

export type FileStorageKind = 's3' | 'local';

export interface RateLimitSetting {
  windowMs: number;
  max: number;
}

export interface RateLimitSettings {
  login: RateLimitSetting;
  api: RateLimitSetting;
  mutation: RateLimitSetting;
  password: RateLimitSetting;
  // Public customer API (no login): per client IP.
  estimateCreate: RateLimitSetting;
  estimateRead: RateLimitSetting;
  estimatePreview: RateLimitSetting;
  // Photo analysis calls the paid Claude API, so it gets the tightest limit.
  imageAnalysis: RateLimitSetting;
  // Customer accounts: password logins that fail, sign-ups, and the e-mail codes (send/check).
  customerLogin: RateLimitSetting;
  customerSignup: RateLimitSetting;
  customerCode: RateLimitSetting;
  // A signed-in customer reading their own requests and quotes: per IP.
  customerRead: RateLimitSetting;
  // A customer's question or request for a consultation about a quote: per IP.
  customerInquiry: RateLimitSetting;
}

export const RATE_LIMIT_DEFAULTS: RateLimitSettings = {
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  api: { windowMs: 60 * 1000, max: 120 },
  mutation: { windowMs: 60 * 1000, max: 30 },
  password: { windowMs: 15 * 60 * 1000, max: 5 },
  estimateCreate: { windowMs: 60 * 60 * 1000, max: 10 },
  estimateRead: { windowMs: 15 * 60 * 1000, max: 30 },
  estimatePreview: { windowMs: 15 * 60 * 1000, max: 60 },
  imageAnalysis: { windowMs: 60 * 60 * 1000, max: 10 },
  customerLogin: { windowMs: 15 * 60 * 1000, max: 10 },
  customerSignup: { windowMs: 60 * 60 * 1000, max: 10 },
  customerCode: { windowMs: 15 * 60 * 1000, max: 20 },
  customerRead: { windowMs: 60 * 1000, max: 60 },
  customerInquiry: { windowMs: 60 * 60 * 1000, max: 20 }
};

const RATE_LIMIT_WINDOW_MS_RANGE = { min: 1000, max: 24 * 60 * 60 * 1000 };
const RATE_LIMIT_MAX_RANGE = { min: 1, max: 100000 };
const TRUST_PROXY_RANGE = { min: 0, max: 10 };

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret?: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  corsOrigins: string[];
  databaseUrl?: string;
  databaseSsl: DatabaseSsl;
  jwtSecret: string;
  jwtExpiration: string;
  refreshTokenExpiration: string;
  cookieSecure: boolean;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  s3Bucket?: string;
  // Where the files of an estimate request are kept: S3, or (not in production) a local folder.
  fileStorage: FileStorageKind;
  localUploadDir: string;
  fileDownloadEnabled: boolean;
  trustProxy: number;
  rateLimits: RateLimitSettings;
  sendgridApiKey?: string;
  sendgridFromEmail?: string;
  adminNotificationEmail?: string;
  emailWorker: {
    enabled: boolean;
    intervalMs: number;
    staleTimeoutMs: number;
  };
  // KakaoTalk notices (receipt, quote arrived, question answered). Off by default. 'log' only writes
  // the message to the log (development): it is refused in production, where no real sending agency
  // is connected yet.
  kakao: {
    enabled: boolean;
    provider: 'log';
    intervalMs: number;
  };
  // Where the customer pages are served (the browser is sent back here after a Google/Kakao login),
  // and the public address of this API (the redirect address registered with Google/Kakao).
  frontendBaseUrl: string;
  publicApiUrl: string;
  oauth: { google?: OAuthProviderConfig; kakao?: OAuthProviderConfig };
  supportEmail?: string;
  supportPhone?: string;
  logLevel?: string;
  sentryDsn?: string;
}

function validateCorsOrigins(corsOriginsStr: string): string[] {
  const origins = corsOriginsStr.split(',').map(o => o.trim());

  if (!origins.length) {
    throw new Error('CORS_ORIGINS must not be empty');
  }

  const hasWildcard = origins.some(o => o.includes('*'));
  if (hasWildcard) {
    throw new Error('Wildcard (*) CORS origins are not allowed');
  }

  return origins;
}

export function parseBooleanEnv(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = raw.trim().toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
}

export function parseIntegerEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const trimmed = raw.trim();
  const value = Number(trimmed);

  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

// FILE_STORAGE: "s3" (the default) or "local", a folder on this machine for development and tests
// without AWS. Local storage is refused in production: files there would be lost with the server.
export function parseFileStorage(raw: string | undefined, nodeEnv: string): FileStorageKind {
  const value = raw === undefined || raw.trim() === '' ? 's3' : raw.trim();
  if (value !== 's3' && value !== 'local') {
    throw new Error('FILE_STORAGE must be "s3" or "local"');
  }
  if (value === 'local' && nodeEnv === 'production') {
    throw new Error('FILE_STORAGE=local is not allowed when NODE_ENV=production: use s3.');
  }
  return value;
}

// The number of reverse proxies in front of the app (Heroku: 1). A number is used on
// purpose: "true" would trust every X-Forwarded-For entry, which clients can forge.
export function parseTrustProxy(raw: string | undefined): number {
  return parseIntegerEnv('TRUST_PROXY', raw, 0, TRUST_PROXY_RANGE.min, TRUST_PROXY_RANGE.max);
}

export function parseRateLimitSetting(
  prefix: string,
  env: NodeJS.ProcessEnv,
  defaults: RateLimitSetting
): RateLimitSetting {
  return {
    windowMs: parseIntegerEnv(
      `${prefix}_WINDOW_MS`,
      env[`${prefix}_WINDOW_MS`],
      defaults.windowMs,
      RATE_LIMIT_WINDOW_MS_RANGE.min,
      RATE_LIMIT_WINDOW_MS_RANGE.max
    ),
    max: parseIntegerEnv(
      `${prefix}_MAX`,
      env[`${prefix}_MAX`],
      defaults.max,
      RATE_LIMIT_MAX_RANGE.min,
      RATE_LIMIT_MAX_RANGE.max
    )
  };
}

export function parseRateLimits(env: NodeJS.ProcessEnv): RateLimitSettings {
  return {
    login: parseRateLimitSetting('ADMIN_LOGIN_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.login),
    api: parseRateLimitSetting('ADMIN_API_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.api),
    mutation: parseRateLimitSetting('ADMIN_MUTATION_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.mutation),
    password: parseRateLimitSetting('ADMIN_PASSWORD_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.password),
    estimateCreate: parseRateLimitSetting(
      'CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT',
      env,
      RATE_LIMIT_DEFAULTS.estimateCreate
    ),
    estimateRead: parseRateLimitSetting(
      'CUSTOMER_ESTIMATE_READ_RATE_LIMIT',
      env,
      RATE_LIMIT_DEFAULTS.estimateRead
    ),
    estimatePreview: parseRateLimitSetting(
      'CUSTOMER_ESTIMATE_PREVIEW_RATE_LIMIT',
      env,
      RATE_LIMIT_DEFAULTS.estimatePreview
    ),
    imageAnalysis: parseRateLimitSetting(
      'CUSTOMER_IMAGE_ANALYSIS_RATE_LIMIT',
      env,
      RATE_LIMIT_DEFAULTS.imageAnalysis
    ),
    customerLogin: parseRateLimitSetting('CUSTOMER_LOGIN_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.customerLogin),
    customerSignup: parseRateLimitSetting('CUSTOMER_SIGNUP_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.customerSignup),
    customerCode: parseRateLimitSetting('CUSTOMER_CODE_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.customerCode),
    customerRead: parseRateLimitSetting('CUSTOMER_READ_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.customerRead),
    customerInquiry: parseRateLimitSetting('CUSTOMER_INQUIRY_RATE_LIMIT', env, RATE_LIMIT_DEFAULTS.customerInquiry)
  };
}

// Settings that must be safe before a production server starts. Development and test keep
// their permissive defaults.
export function assertProductionSettings(
  nodeEnv: string,
  settings: { cookieSecure: boolean }
): void {
  if (nodeEnv === 'production' && !settings.cookieSecure) {
    throw new Error(
      'COOKIE_SECURE must be "true" when NODE_ENV=production: admin cookies would be sent over plain HTTP.'
    );
  }
}

// Things that are allowed but probably not what the operator wants in production.
export function parseKakao(env: NodeJS.ProcessEnv, nodeEnv: string): AppConfig['kakao'] {
  const enabled = env.KAKAO_NOTIFY_ENABLED === 'true';
  const provider = env.KAKAO_PROVIDER ?? 'log';
  if (provider !== 'log') {
    throw new Error('KAKAO_PROVIDER must be "log": no sending agency is connected yet');
  }
  if (enabled && nodeEnv === 'production') {
    throw new Error('KAKAO_NOTIFY_ENABLED=true is not possible in production yet: only the "log" provider exists, and it sends nothing');
  }
  const intervalMs = parseInt(env.KAKAO_WORKER_INTERVAL_MS || '30000', 10);
  return { enabled, provider, intervalMs: Number.isFinite(intervalMs) && intervalMs >= 1000 ? intervalMs : 30000 };
}

export function productionWarnings(settings: {
  nodeEnv: string;
  trustProxy: number;
  databaseSsl: DatabaseSsl;
}): string[] {
  if (settings.nodeEnv !== 'production') {
    return [];
  }

  const warnings: string[] = [];
  if (settings.trustProxy === 0) {
    warnings.push(
      'TRUST_PROXY is 0: behind a reverse proxy (Heroku: 1) every client shares the proxy IP, so the rate limits and audit logs are wrong. ' +
        'The public customer API limits (estimate creation: 10 per hour per IP by default) would then be shared by ALL customers together and block the site.'
    );
  }
  if (settings.databaseSsl && !settings.databaseSsl.rejectUnauthorized) {
    warnings.push(
      'DATABASE_SSL_REJECT_UNAUTHORIZED is false: the database connection is encrypted but the server certificate is not verified.'
    );
  }
  return warnings;
}

// A base address from the environment: http(s) only, no path, query or trailing slash.
export function parseBaseUrl(name: string, raw: string | undefined, fallback: string): string {
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a full http(s) address`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an http(s) address without a path, query or fragment`);
  }
  return url.origin;
}

// A provider is on only when its client id is set; the secret is needed by Google, optional for Kakao.
export function parseOAuthProvider(
  idName: string,
  secretName: string,
  env: NodeJS.ProcessEnv,
  secretRequired: boolean
): OAuthProviderConfig | undefined {
  const clientId = env[idName]?.trim();
  if (!clientId) {
    return undefined;
  }
  const clientSecret = env[secretName]?.trim() || undefined;
  if (secretRequired && !clientSecret) {
    throw new Error(`${secretName} is required when ${idName} is set`);
  }
  return { clientId, clientSecret };
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const port = parseInt(process.env.PORT || '4000', 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid port number between 1 and 65535');
  }

  const corsOriginsStr = process.env.CORS_ORIGINS || 'http://localhost:3000';
  let corsOrigins: string[];

  try {
    corsOrigins = validateCorsOrigins(corsOriginsStr);
  } catch (err) {
    throw new Error(`Invalid CORS_ORIGINS: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Day 3: Authentication required variables
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required (minimum 32 characters)');
  }
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  const config: AppConfig = {
    nodeEnv,
    port,
    corsOrigins,
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: resolveDatabaseSsl(process.env, nodeEnv),
    jwtSecret,
    jwtExpiration: process.env.JWT_EXPIRATION || '8h',
    refreshTokenExpiration: process.env.REFRESH_TOKEN_EXPIRATION || '30d',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    awsRegion: process.env.AWS_REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET,
    fileStorage: parseFileStorage(process.env.FILE_STORAGE, nodeEnv),
    localUploadDir: process.env.LOCAL_UPLOAD_DIR || 'uploads-dev',
    fileDownloadEnabled: parseBooleanEnv('FILE_DOWNLOAD_ENABLED', process.env.FILE_DOWNLOAD_ENABLED, false),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    rateLimits: parseRateLimits(process.env),
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL,
    adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL,
    emailWorker: {
      enabled: nodeEnv !== 'test' && process.env.EMAIL_WORKER_ENABLED === 'true',
      intervalMs: parseInt(process.env.EMAIL_WORKER_INTERVAL_MS || '30000', 10),
      staleTimeoutMs: parseInt(process.env.EMAIL_WORKER_STALE_TIMEOUT_MS || '300000', 10)
    },
    kakao: parseKakao(process.env, nodeEnv),
    frontendBaseUrl: parseBaseUrl('FRONTEND_BASE_URL', process.env.FRONTEND_BASE_URL, corsOrigins[0]),
    publicApiUrl: parseBaseUrl('PUBLIC_API_URL', process.env.PUBLIC_API_URL, `http://localhost:${port}`),
    oauth: {
      google: parseOAuthProvider('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', process.env, true),
      kakao: parseOAuthProvider('KAKAO_CLIENT_ID', 'KAKAO_CLIENT_SECRET', process.env, false)
    },
    supportEmail: process.env.SUPPORT_EMAIL,
    supportPhone: process.env.SUPPORT_PHONE,
    logLevel: process.env.LOG_LEVEL || 'info',
    sentryDsn: process.env.SENTRY_DSN
  };

  assertProductionSettings(nodeEnv, config);

  return config;
}

export const config = loadConfig();
