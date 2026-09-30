import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  corsOrigins: string[];
  databaseUrl?: string;
  jwtSecret?: string;
  jwtExpiration?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  s3Bucket?: string;
  sendgridApiKey?: string;
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

  const config: AppConfig = {
    nodeEnv,
    port,
    corsOrigins,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiration: process.env.JWT_EXPIRATION || '8h',
    awsRegion: process.env.AWS_REGION,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.S3_BUCKET,
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    supportEmail: process.env.SUPPORT_EMAIL,
    supportPhone: process.env.SUPPORT_PHONE,
    logLevel: process.env.LOG_LEVEL || 'info',
    sentryDsn: process.env.SENTRY_DSN
  };

  return config;
}

export const config = loadConfig();
