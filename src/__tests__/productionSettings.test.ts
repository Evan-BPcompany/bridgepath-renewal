export {};

import {
  findTlsUrlParams,
  resolveDatabaseSsl
} from '../db/connectionSafety';

type EnvModule = typeof import('../config/env');

// Loads config/env.ts with a given environment, in a fresh module registry. dotenv never
// overrides a variable that is already set, so every value the test cares about is set here.
function loadEnv(env: Record<string, string>): EnvModule {
  const saved = { ...process.env };
  const keys = [
    'NODE_ENV',
    'COOKIE_SECURE',
    'DATABASE_URL',
    'DATABASE_SSL',
    'DATABASE_SSL_REJECT_UNAUTHORIZED',
    'TRUST_PROXY'
  ];
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, env);

  try {
    let loaded!: EnvModule;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('../config/env');
    });
    return loaded;
  } finally {
    keys.forEach(key => delete process.env[key]);
    Object.assign(process.env, saved);
  }
}

const PROD = { NODE_ENV: 'production', COOKIE_SECURE: 'true', TRUST_PROXY: '1' };

describe('production cookie setting', () => {
  it('refuses to start in production when COOKIE_SECURE is missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE must be "true"/);
  });

  it.each(['false', '', '1', 'yes', 'TRUE '])('refuses COOKIE_SECURE=%j in production', value => {
    expect(() => loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: value })).toThrow(/COOKIE_SECURE/);
  });

  it('starts in production with COOKIE_SECURE=true', () => {
    expect(loadEnv(PROD).config.cookieSecure).toBe(true);
  });

  it.each(['development', 'test'])('keeps the old behaviour in %s: no COOKIE_SECURE needed', nodeEnv => {
    const { config } = loadEnv({ NODE_ENV: nodeEnv, COOKIE_SECURE: 'false' });

    expect(config.cookieSecure).toBe(false);
    expect(config.nodeEnv).toBe(nodeEnv);
  });

  it('assertProductionSettings only looks at production', () => {
    const { assertProductionSettings } = loadEnv({ NODE_ENV: 'test' });

    expect(() => assertProductionSettings('production', { cookieSecure: false })).toThrow();
    expect(() => assertProductionSettings('production', { cookieSecure: true })).not.toThrow();
    expect(() => assertProductionSettings('development', { cookieSecure: false })).not.toThrow();
    expect(() => assertProductionSettings('test', { cookieSecure: false })).not.toThrow();
  });
});

describe('production warnings', () => {
  const { productionWarnings } = loadEnv({ NODE_ENV: 'test' });

  it('warns about TRUST_PROXY=0 and an unverified database certificate, only in production', () => {
    const warnings = productionWarnings({
      nodeEnv: 'production',
      trustProxy: 0,
      databaseSsl: { rejectUnauthorized: false }
    });

    expect(warnings).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/TRUST_PROXY/);
    // The warning says what is at stake for the public customer API.
    expect(warnings.join(' ')).toMatch(/shared by ALL customers/);
    expect(warnings.join(' ')).toMatch(/DATABASE_SSL_REJECT_UNAUTHORIZED/);
  });

  it('is quiet for a good production setup and outside production', () => {
    expect(
      productionWarnings({ nodeEnv: 'production', trustProxy: 1, databaseSsl: { rejectUnauthorized: true } })
    ).toEqual([]);
    expect(productionWarnings({ nodeEnv: 'development', trustProxy: 0, databaseSsl: false })).toEqual([]);
  });
});

describe('database TLS settings', () => {
  it('is on and verified by default in production', () => {
    expect(resolveDatabaseSsl({}, 'production')).toEqual({ rejectUnauthorized: true });
  });

  it('is off by default outside production', () => {
    expect(resolveDatabaseSsl({}, 'development')).toBe(false);
    expect(resolveDatabaseSsl({}, 'test')).toBe(false);
  });

  it('can be turned on outside production', () => {
    expect(resolveDatabaseSsl({ DATABASE_SSL: 'true' }, 'development')).toEqual({ rejectUnauthorized: true });
  });

  it('lets Heroku turn certificate verification off explicitly', () => {
    expect(
      resolveDatabaseSsl({ DATABASE_SSL: 'true', DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }, 'production')
    ).toEqual({ rejectUnauthorized: false });
    expect(resolveDatabaseSsl({ DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }, 'production')).toEqual({
      rejectUnauthorized: false
    });
  });

  it('accepts true/false in any case with spaces', () => {
    expect(resolveDatabaseSsl({ DATABASE_SSL: ' TRUE ' }, 'development')).toEqual({ rejectUnauthorized: true });
    expect(resolveDatabaseSsl({ DATABASE_SSL: ' False ' }, 'development')).toBe(false);
  });

  it('never allows a plaintext connection in production', () => {
    expect(() => resolveDatabaseSsl({ DATABASE_SSL: 'false' }, 'production')).toThrow(
      /DATABASE_SSL=false is not allowed/
    );
  });

  it('rejects values that are not true/false', () => {
    expect(() => resolveDatabaseSsl({ DATABASE_SSL: 'yes' }, 'production')).toThrow(/DATABASE_SSL must be/);
    expect(() => resolveDatabaseSsl({ DATABASE_SSL_REJECT_UNAUTHORIZED: '0' }, 'production')).toThrow(
      /DATABASE_SSL_REJECT_UNAUTHORIZED must be/
    );
  });

  it('treats a blank value as unset', () => {
    expect(resolveDatabaseSsl({ DATABASE_SSL: '  ' }, 'production')).toEqual({ rejectUnauthorized: true });
  });

  describe('TLS parameters inside DATABASE_URL', () => {
    it.each(['sslmode=disable', 'sslmode=require', 'ssl=false', 'sslrootcert=/x.pem', 'uselibpqcompat=true'])(
      'are refused in production (%s) because they would override the environment variables',
      query => {
        const env = { DATABASE_URL: `postgres://u:p@host.example.invalid:5432/app?${query}` };

        expect(() => resolveDatabaseSsl(env, 'production')).toThrow(/must not contain TLS parameters/);
      }
    );

    it('are tolerated outside production', () => {
      const env = { DATABASE_URL: 'postgres://u:p@localhost:5432/app?sslmode=disable' };

      expect(resolveDatabaseSsl(env, 'development')).toBe(false);
    });

    it('does not put the URL or its password into the error', () => {
      const env = { DATABASE_URL: 'postgres://u:TopSecretPw@host.example.invalid/app?sslmode=disable' };

      try {
        resolveDatabaseSsl(env, 'production');
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as Error).message).not.toContain('TopSecretPw');
        expect((err as Error).message).not.toContain('host.example.invalid');
      }
    });

    it('findTlsUrlParams handles missing and unparsable URLs', () => {
      expect(findTlsUrlParams(undefined)).toEqual([]);
      expect(findTlsUrlParams('  ')).toEqual([]);
      expect(findTlsUrlParams('not a url')).toEqual([]);
      expect(findTlsUrlParams('postgres://u:p@h/db')).toEqual([]);
      expect(findTlsUrlParams('postgres://u:p@h/db?application_name=x&sslmode=require')).toEqual(['sslmode']);
    });
  });

  describe('config and pool wiring', () => {
    it('config carries the resolved TLS setting', () => {
      expect(loadEnv(PROD).config.databaseSsl).toEqual({ rejectUnauthorized: true });
      expect(
        loadEnv({ ...PROD, DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }).config.databaseSsl
      ).toEqual({ rejectUnauthorized: false });
      expect(loadEnv({ NODE_ENV: 'development' }).config.databaseSsl).toBe(false);
    });

    it('production cannot start with a plaintext database connection', () => {
      expect(() => loadEnv({ ...PROD, DATABASE_SSL: 'false' })).toThrow(/DATABASE_SSL=false/);
      expect(() =>
        loadEnv({ ...PROD, DATABASE_URL: 'postgres://u:p@h.example.invalid/app?sslmode=disable' })
      ).toThrow(/TLS parameters/);
    });
  });
});
