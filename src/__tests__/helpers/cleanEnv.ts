// Environment for child processes started by tests. Anything that could point a child at a
// real database or a real service (DATABASE_URL, AWS, SendGrid, ...) is removed first; each
// test then adds only the values it needs, and those are fake.

const REMOVED = /^(DATABASE_URL|TEST_DATABASE_URL|REQUIRE_INTEGRATION|DATABASE_SSL.*|PG[A-Z]*|AWS_.*|S3_BUCKET|SENDGRID_.*|ADMIN_NOTIFICATION_EMAIL|SENTRY_DSN|JWT_SECRET|NODE_OPTIONS|JEST_WORKER_ID)$/;

export function cleanChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !REMOVED.test(key)) {
      env[key] = value;
    }
  }

  return { ...env, ...extra };
}
