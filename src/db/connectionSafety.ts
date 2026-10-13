import { randomBytes } from 'crypto';

// Pure helpers that decide whether a database URL may be used. They never connect to
// anything, never include a password in a message, and are shared by knexfile.ts, the
// integration test harness and the unit tests.

export const LOCAL_DB_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  database: string;
}

export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return null;
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (url.hostname === '' || database === '') {
    return null;
  }

  return {
    host: url.hostname.toLowerCase(),
    port: url.port === '' ? 5432 : Number(url.port),
    database
  };
}

// "host:port/database" only: no user name, no password, no query string.
export function describeDatabaseUrl(parsed: ParsedDatabaseUrl): string {
  return `${parsed.host}:${parsed.port}/${parsed.database}`;
}

export function isLocalHost(host: string): boolean {
  return LOCAL_DB_HOSTS.includes(host.toLowerCase());
}

// Two URLs point at the same database when host, port and database name match;
// credentials and options are ignored on purpose.
export function sameDatabase(a: string, b: string): boolean {
  const first = parseDatabaseUrl(a);
  const second = parseDatabaseUrl(b);
  if (!first || !second) {
    return a === b;
  }
  return first.host === second.host && first.port === second.port && first.database === second.database;
}

type Env = Record<string, string | undefined>;

// Used by the tooling that needs a real database (knex CLI, setup script). There is no
// fallback: a missing URL stops the command instead of guessing localhost credentials.
export function requireDatabaseUrl(env: Env, name = 'DATABASE_URL'): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set. Set it explicitly; there is no default database.`);
  }
  return value;
}

export type TestDatabaseCheck =
  | { ok: true; url: string; description: string }
  | {
      ok: false;
      code: 'NOT_SET' | 'INVALID_URL' | 'SAME_AS_DATABASE_URL' | 'REMOTE_HOST' | 'NOT_A_TEST_DATABASE';
      message: string;
    };

// Rules for TEST_DATABASE_URL, the only database tests may use:
//  - it must be set and be a postgres:// URL
//  - it must not point at the same database as DATABASE_URL
//  - the host must be this machine (a remote database is never allowed)
//  - the database name must contain "test"
export function checkTestDatabaseUrl(env: Env): TestDatabaseCheck {
  const url = env.TEST_DATABASE_URL;

  if (url === undefined || url.trim() === '') {
    return { ok: false, code: 'NOT_SET', message: 'TEST_DATABASE_URL is not set.' };
  }

  const parsed = parseDatabaseUrl(url);
  if (!parsed) {
    return {
      ok: false,
      code: 'INVALID_URL',
      message: 'TEST_DATABASE_URL is not a valid postgres:// or postgresql:// URL.'
    };
  }

  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim() !== '' && sameDatabase(url, databaseUrl)) {
    return {
      ok: false,
      code: 'SAME_AS_DATABASE_URL',
      message: 'TEST_DATABASE_URL must not be the same database as DATABASE_URL.'
    };
  }

  if (!isLocalHost(parsed.host)) {
    return {
      ok: false,
      code: 'REMOTE_HOST',
      message: `TEST_DATABASE_URL points at a remote host (${parsed.host}); only a database on this machine is allowed.`
    };
  }

  if (!/test/i.test(parsed.database)) {
    return {
      ok: false,
      code: 'NOT_A_TEST_DATABASE',
      message: `The database name "${parsed.database}" does not contain "test"; refusing to use it for tests.`
    };
  }

  return { ok: true, url, description: describeDatabaseUrl(parsed) };
}

// Isolated schema per test run. The name is generated, never taken from input, and is
// validated before it is placed into SQL.
export const SCHEMA_NAME_PATTERN = /^it_[0-9a-f]{8}$/;

export function createSchemaName(): string {
  return `it_${randomBytes(4).toString('hex')}`;
}

export function assertSchemaName(name: string): string {
  if (!SCHEMA_NAME_PATTERN.test(name)) {
    throw new Error('Invalid test schema name.');
  }
  return name;
}

// ---------------------------------------------------------------------------------------
// TLS for the application database (target: Heroku PostgreSQL, which requires TLS).
//
//   DATABASE_SSL                     true | false. Default: true in production, false elsewhere.
//   DATABASE_SSL_REJECT_UNAUTHORIZED true | false. Default: true (verify the server certificate).
//
// Heroku's certificate is not signed by a public CA, so a Heroku deployment has to set
// DATABASE_SSL_REJECT_UNAUTHORIZED=false: the traffic is encrypted but the server is not
// authenticated. That is a conscious, visible choice instead of a hard-coded one.
// ---------------------------------------------------------------------------------------

export type DatabaseSsl = false | { rejectUnauthorized: boolean };

function readBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
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

// Query parameters in the URL that would silently override the settings above.
const URL_TLS_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

export function findTlsUrlParams(databaseUrl: string | undefined): string[] {
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    return [];
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return [];
  }
  return URL_TLS_PARAMS.filter(name => url.searchParams.has(name));
}

// Decides the ssl option for pg and knex. In production a plaintext connection is refused
// (it would send the password and all data unencrypted) and so is a URL that carries its own
// TLS parameters (they would override the environment variables).
export function resolveDatabaseSsl(env: Env, nodeEnv: string): DatabaseSsl {
  const production = nodeEnv === 'production';
  const enabled = readBoolean(env, 'DATABASE_SSL', production);
  const rejectUnauthorized = readBoolean(env, 'DATABASE_SSL_REJECT_UNAUTHORIZED', true);

  if (production) {
    if (!enabled) {
      throw new Error(
        'DATABASE_SSL=false is not allowed when NODE_ENV=production: the database connection would be unencrypted.'
      );
    }
    const params = findTlsUrlParams(env.DATABASE_URL);
    if (params.length > 0) {
      throw new Error(
        `DATABASE_URL must not contain TLS parameters (${params.join(', ')}) when NODE_ENV=production; ` +
          'use DATABASE_SSL and DATABASE_SSL_REJECT_UNAUTHORIZED instead.'
      );
    }
  }

  return enabled ? { rejectUnauthorized } : false;
}
