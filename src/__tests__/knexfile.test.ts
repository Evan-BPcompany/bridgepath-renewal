import fs from 'fs';
import path from 'path';

const knexfilePath = path.join(__dirname, '..', '..', 'knexfile.ts');

type ConnectionFn = () => { connectionString: string; ssl?: unknown };

interface EnvConfig {
  client: string;
  connection: ConnectionFn | unknown;
  migrations?: { directory: string };
  pool?: { min: number; max: number };
}

const ENV_NAMES = ['DATABASE_URL', 'TEST_DATABASE_URL', 'DATABASE_SSL', 'DATABASE_SSL_REJECT_UNAUTHORIZED'];

// Runs fn with exactly this database environment. The connection functions of knexfile.ts
// read process.env when they are called, and they only read it: nothing connects to anything.
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]));

  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[name] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
  }
}

function loadKnexfile(): Record<string, EnvConfig> {
  return withEnv({}, () => {
    let config: Record<string, EnvConfig> = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config = require('../../knexfile');
    });
    return config;
  });
}

// Evaluates the lazy connection of one environment with the given database variables.
const connect = (name: string, env: Record<string, string | undefined> = {}) =>
  withEnv(env, () => (loadKnexfile()[name].connection as ConnectionFn)());

describe('knexfile.ts has no default database', () => {
  it('has no localhost host, user name or password in its source', () => {
    const source = fs.readFileSync(knexfilePath, 'utf8');

    expect(source).not.toMatch(/password:\s*['"]/);
    expect(source).not.toMatch(/user:\s*['"]/);
    expect(source).not.toMatch(/host:\s*['"]localhost['"]/);
    expect(source).not.toMatch(/postgres:postgres/);
    expect(source).not.toMatch(/DB_HOST|DB_USER|DB_PASSWORD|DB_NAME/);
  });

  it('reads every connection lazily (a function, nothing evaluated while loading)', () => {
    const config = loadKnexfile();

    for (const name of ['development', 'production', 'test']) {
      expect(typeof config[name].connection).toBe('function');
      expect(config[name].client).toBe('pg');
    }
  });

  describe('development and production', () => {
    it.each([['development'], ['production']])('%s stops with a clear message without DATABASE_URL', name => {
      expect(() => connect(name)).toThrow('DATABASE_URL is not set. Set it explicitly; there is no default database.');
    });

    it.each([['development'], ['production']])('%s uses DATABASE_URL when it is set', name => {
      expect(connect(name, { DATABASE_URL: 'postgres://u:p@db.example.invalid:5432/app' }).connectionString).toBe(
        'postgres://u:p@db.example.invalid:5432/app'
      );
    });

    it('production uses TLS with certificate verification unless told otherwise', () => {
      const url = 'postgres://u:p@db.example.invalid:5432/app';

      expect(connect('production', { DATABASE_URL: url }).ssl).toEqual({ rejectUnauthorized: true });
      expect(
        connect('production', { DATABASE_URL: url, DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }).ssl
      ).toEqual({ rejectUnauthorized: false });
    });

    it('production refuses a plaintext connection or TLS parameters in the URL', () => {
      const url = 'postgres://u:p@db.example.invalid:5432/app';

      expect(() => connect('production', { DATABASE_URL: url, DATABASE_SSL: 'false' })).toThrow(
        /DATABASE_SSL=false is not allowed/
      );
      expect(() => connect('production', { DATABASE_URL: `${url}?sslmode=disable` })).toThrow(
        /TLS parameters/
      );
    });

    it('development has no TLS by default', () => {
      expect(connect('development', { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app' }).ssl).toBeUndefined();
    });

    it('never falls back to TEST_DATABASE_URL', () => {
      const env = { TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_test' };

      expect(() => connect('development', env)).toThrow('DATABASE_URL is not set');
      expect(() => connect('production', env)).toThrow('DATABASE_URL is not set');
    });
  });

  describe('test environment', () => {
    it('stops without TEST_DATABASE_URL, even when DATABASE_URL is set', () => {
      expect(() => connect('test', { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_dev' })).toThrow(
        'TEST_DATABASE_URL is not set.'
      );
    });

    it('uses a safe local test database', () => {
      const env = {
        TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_test',
        DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_dev'
      };

      expect(connect('test', env).connectionString).toBe('postgres://u:p@127.0.0.1:5432/app_test');
    });

    it('refuses the same database in both variables', () => {
      const env = {
        TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_test',
        DATABASE_URL: 'postgres://other:other@127.0.0.1:5432/app_test'
      };

      expect(() => connect('test', env)).toThrow('TEST_DATABASE_URL must not be the same database as DATABASE_URL.');
    });

    it('refuses a remote host and a database without "test" in its name', () => {
      expect(() => connect('test', { TEST_DATABASE_URL: 'postgres://u:p@db.example.invalid/app_test' })).toThrow(
        /remote host/
      );
      expect(() => connect('test', { TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1/app_dev' })).toThrow(
        /does not contain "test"/
      );
    });

    it('does not leak credentials in its messages', () => {
      try {
        connect('test', { TEST_DATABASE_URL: 'postgres://tester:SuperSecretDbPw@db.example.invalid/app_test' });
        throw new Error('expected a refusal');
      } catch (err) {
        expect((err as Error).message).not.toContain('SuperSecretDbPw');
        expect((err as Error).message).not.toContain('tester');
      }
    });
  });

  it('keeps the migration directory and the production pool size', () => {
    const config = loadKnexfile();

    expect(config.development.migrations?.directory).toBe('./src/db/migrations');
    expect(config.test.migrations?.directory).toBe('./src/db/migrations');
    expect(config.production.pool).toEqual({ min: 2, max: 10 });
  });
});
