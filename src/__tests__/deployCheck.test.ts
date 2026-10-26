import {
  CheckResult,
  Env,
  checkDatabaseState,
  checkDeployment,
  readFrontConfig,
  registrableDomain,
  summarize
} from '../utils/deployCheck';

// A production setting that is right in every way (the values are made up).
const GOOD: Env = {
  NODE_ENV: 'production',
  JWT_SECRET: 'q8Zr1vXb4Tn7LmW0yUe3PcA6dHs9GfJk2NoVt5RiBxQlEzMw', // secret-scan:allow
  COOKIE_SECURE: 'true',
  TRUST_PROXY: '1',
  DATABASE_URL: 'postgres://user:pw@db.example.com:5432/bridgepath',
  DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
  CORS_ORIGINS: 'https://www.example.com',
  FRONTEND_BASE_URL: 'https://www.example.com',
  PUBLIC_API_URL: 'https://api.example.com',
  FILE_STORAGE: 's3',
  AWS_REGION: 'ap-northeast-2',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-value',
  S3_BUCKET: 'bridgepath-files',
  SENDGRID_API_KEY: 'SG.example',
  SENDGRID_FROM_EMAIL: 'no-reply@example.com',
  EMAIL_WORKER_ENABLED: 'true',
  ADMIN_NOTIFICATION_EMAIL: 'staff@example.com',
  SUPPORT_EMAIL: 'help@example.com',
  ANTHROPIC_API_KEY: 'sk-ant-example',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  KAKAO_CLIENT_ID: 'kakao-id'
};
const APPROVED = ['2026-v1'];

const run = (over: Env = {}, approved: readonly string[] = APPROVED, front?: string): CheckResult[] =>
  checkDeployment({ env: { ...GOOD, ...over }, approvedConsentVersions: approved, frontConfigSource: front });
const level = (results: CheckResult[], id: string): string[] => results.filter(item => item.id === id).map(item => item.level);
const without = (name: string): Env => ({ [name]: undefined });

describe('a setting that is right in every way', () => {
  it('has no failure and no warning', () => {
    const results = run();

    expect(results.filter(item => item.level !== 'ok')).toEqual([]);
    expect(summarize(results)).toEqual({ ok: results.length, warn: 0, fail: 0 });
  });

  it('shows no value of a secret anywhere', () => {
    const text = JSON.stringify(run({ JWT_SECRET: 'short' }));

    for (const secret of ['aws-secret-value', 'SG.example', 'sk-ant-example', 'google-secret', GOOD.JWT_SECRET!, 'pw@db.example.com']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the core settings', () => {
  it.each([[undefined], ['development'], ['test'], ['']])('fails for NODE_ENV %j', value => {
    expect(level(run({ NODE_ENV: value }), 'node-env')).toEqual(['fail']);
  });

  it('fails for a JWT secret that is missing or short, and warns for one that looks like a placeholder', () => {
    expect(level(run(without('JWT_SECRET')), 'jwt-secret')).toEqual(['fail']);
    expect(level(run({ JWT_SECRET: 'x'.repeat(31) }), 'jwt-secret')).toEqual(['fail']);
    expect(level(run({ JWT_SECRET: 'change-me-change-me-change-me-change-me' }), 'jwt-secret')).toEqual(['warn']); // secret-scan:allow
    expect(level(run({ JWT_SECRET: 'a'.repeat(48) }), 'jwt-secret')).toEqual(['warn']);
    expect(level(run({ JWT_SECRET: 'demo-secret-demo-secret-demo-secret-1234' }), 'jwt-secret')).toEqual(['warn']); // secret-scan:allow
  });

  it.each([[undefined], ['false'], ['TRUE'], ['1']])('fails for COOKIE_SECURE %j (the server wants exactly "true")', value => {
    expect(level(run({ COOKIE_SECURE: value }), 'cookie-secure')).toEqual(['fail']);
  });

  it('judges TRUST_PROXY: a whole number from 1 to 10 is fine, 0 or nothing warns, the rest fails', () => {
    expect(level(run({ TRUST_PROXY: '1' }), 'trust-proxy')).toEqual(['ok']);
    expect(level(run({ TRUST_PROXY: '2' }), 'trust-proxy')).toEqual(['ok']);
    expect(level(run({ TRUST_PROXY: '0' }), 'trust-proxy')).toEqual(['warn']);
    expect(level(run(without('TRUST_PROXY')), 'trust-proxy')).toEqual(['warn']);
    for (const bad of ['true', '-1', '1.5', '11', 'one']) {
      expect(level(run({ TRUST_PROXY: bad }), 'trust-proxy')).toEqual(['fail']);
    }
  });
});

describe('the database', () => {
  it('fails without an address or with one that is not PostgreSQL, warns for one on this machine', () => {
    expect(level(run(without('DATABASE_URL')), 'database-url')).toEqual(['fail']);
    expect(level(run({ DATABASE_URL: 'mysql://u:p@db.example.com/x' }), 'database-url')).toEqual(['fail']);
    expect(level(run({ DATABASE_URL: 'not a url' }), 'database-url')).toEqual(['fail']);
    expect(level(run({ DATABASE_URL: 'postgres://u:p@localhost:5432/x' }), 'database-url')).toEqual(['warn']);
    expect(level(run({ DATABASE_URL: 'postgresql://u:p@db.example.com/x' }), 'database-url')).toEqual(['ok']);
  });

  it.each(['sslmode=require', 'ssl=true', 'SSLMODE=disable', 'sslrootcert=x', 'uselibpqcompat=true'])(
    'fails for an address with %s (the server refuses it in production)',
    parameter => {
      expect(level(run({ DATABASE_URL: `postgres://u:p@db.example.com/x?${parameter}` }), 'database-url')).toEqual(['fail']);
    }
  );

  it('fails for DATABASE_SSL=false and warns when the certificate is not verified', () => {
    expect(level(run({ DATABASE_SSL: 'false' }), 'database-ssl')).toEqual(['fail']);
    expect(level(run({ DATABASE_SSL: 'FALSE' }), 'database-ssl')).toEqual(['fail']);
    expect(level(run({ DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }), 'database-ssl')).toEqual(['warn']);
    expect(level(run({ DATABASE_SSL: 'true' }), 'database-ssl')).toEqual(['ok']);
  });

  it('does not put the address of the database into a message', () => {
    expect(JSON.stringify(run({ DATABASE_URL: 'postgres://admin:hunter2@db.example.com/x?sslmode=require' }))).not.toMatch(/hunter2|admin:/);
  });
});

describe('the addresses', () => {
  it('fails for CORS origins that are missing, with *, with a path, local or without https', () => {
    expect(level(run(without('CORS_ORIGINS')), 'cors')).toEqual(['fail']);
    for (const bad of ['*', 'https://*.example.com', 'https://www.example.com/app', 'http://www.example.com', 'http://localhost:3000', 'https://127.0.0.1', 'www.example.com']) {
      expect(level(run({ CORS_ORIGINS: bad }), 'cors')).toContain('fail');
    }
    expect(level(run({ CORS_ORIGINS: 'https://www.example.com,https://example.com' }), 'cors')).toEqual(['ok']);
  });

  it('names the wrong entry among several, without printing a strange character', () => {
    const results = run({ CORS_ORIGINS: 'https://www.example.com,http://localhost:3000' });

    expect(results.filter(item => item.id === 'cors').map(item => item.title)).toEqual(['CORS_ORIGINS has a local address: http://localhost:3000']);
  });

  it('wants FRONTEND_BASE_URL and PUBLIC_API_URL as https origins, and PUBLIC_API_URL to be set', () => {
    expect(level(run(without('FRONTEND_BASE_URL')), 'frontend-url')).toEqual(['warn']);
    expect(level(run({ FRONTEND_BASE_URL: 'https://www.example.com/app' }), 'frontend-url')).toEqual(['fail']);
    expect(level(run({ FRONTEND_BASE_URL: 'http://www.example.com' }), 'frontend-url')).toEqual(['fail']);
    expect(level(run({ FRONTEND_BASE_URL: 'http://localhost:3000' }), 'frontend-url')).toEqual(['fail']);
    expect(level(run(without('PUBLIC_API_URL')), 'public-api-url')).toEqual(['fail']);
    expect(level(run({ PUBLIC_API_URL: 'http://localhost:4000' }), 'public-api-url')).toEqual(['fail']);
    expect(level(run({ PUBLIC_API_URL: 'https://api.example.com/api' }), 'public-api-url')).toEqual(['fail']);
    expect(level(run({ PUBLIC_API_URL: 'api.example.com' }), 'public-api-url')).toEqual(['fail']);
  });

  describe('the same site', () => {
    it('is fine for the pages and the API under one domain', () => {
      expect(level(run(), 'same-site')).toEqual(['ok']);
      expect(level(run({ FRONTEND_BASE_URL: 'https://example.com', CORS_ORIGINS: 'https://example.com' }), 'same-site')).toEqual(['ok']);
      expect(level(run({ FRONTEND_BASE_URL: 'https://shop.example.co.kr', CORS_ORIGINS: 'https://shop.example.co.kr', PUBLIC_API_URL: 'https://api.example.co.kr' }), 'same-site')).toEqual(['ok']);
    });

    it('fails for two domains of your own', () => {
      const results = run({ PUBLIC_API_URL: 'https://api.other.com' });

      expect(level(results, 'same-site')).toEqual(['fail']);
      expect(results.find(item => item.id === 'same-site')!.title).toBe('The pages (example.com) and the API (other.com) are not on the same site');
    });

    it('fails for the names that hosting platforms give out, which are not one site', () => {
      expect(level(run({ FRONTEND_BASE_URL: 'https://shop.netlify.app', CORS_ORIGINS: 'https://shop.netlify.app', PUBLIC_API_URL: 'https://api.herokuapp.com' }), 'same-site')).toEqual(['fail']);
      expect(level(run({ FRONTEND_BASE_URL: 'https://a.herokuapp.com', CORS_ORIGINS: 'https://a.herokuapp.com', PUBLIC_API_URL: 'https://b.herokuapp.com' }), 'same-site')).toEqual(['fail']);
      expect(level(run({ FRONTEND_BASE_URL: 'https://a.herokuapp.com', CORS_ORIGINS: 'https://a.herokuapp.com', PUBLIC_API_URL: 'https://a.herokuapp.com' }), 'same-site')).toEqual(['ok']);
    });

    it('uses the first CORS origin for the pages when FRONTEND_BASE_URL is missing', () => {
      expect(level(run({ ...without('FRONTEND_BASE_URL'), CORS_ORIGINS: 'https://www.other.com' }), 'same-site')).toEqual(['fail']);
      expect(level(run(without('FRONTEND_BASE_URL')), 'same-site')).toEqual(['ok']);
    });

    it('warns for a second CORS origin on another site, which could not sign in', () => {
      const results = run({ CORS_ORIGINS: 'https://www.example.com,https://www.other.com' });

      expect(level(results, 'cors-same-site')).toEqual(['warn']);
      expect(level(results, 'same-site')).toEqual(['ok']);
    });
  });

  describe('registrableDomain', () => {
    it.each([
      ['www.example.com', 'example.com'],
      ['api.v2.example.com', 'example.com'],
      ['example.com', 'example.com'],
      ['shop.example.co.kr', 'example.co.kr'],
      ['a.herokuapp.com', 'a.herokuapp.com'],
      ['x.y.netlify.app', 'y.netlify.app'],
      ['EXAMPLE.com.', 'example.com'],
      ['127.0.0.1', '127.0.0.1'],
      ['localhost', 'localhost']
    ])('%s is of the site %s', (host, expected) => {
      expect(registrableDomain(host)).toBe(expected);
    });
  });
});

describe('files, e-mail and the services', () => {
  it('fails for local file storage, a missing S3 setting, and a download that is switched on', () => {
    expect(level(run({ FILE_STORAGE: 'local' }), 'file-storage')).toEqual(['fail']);
    expect(level(run({ FILE_STORAGE: 'ftp' }), 'file-storage')).toEqual(['fail']);
    expect(level(run(without('FILE_STORAGE')), 'file-storage')).toEqual(['ok']);
    for (const name of ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET']) {
      const results = run(without(name));
      expect(level(results, 'file-storage')).toEqual(['fail']);
      expect(results.find(item => item.id === 'file-storage')!.title).toContain(name);
    }
    expect(level(run({ FILE_DOWNLOAD_ENABLED: 'true' }), 'file-download')).toEqual(['fail']);
    expect(level(run({ FILE_DOWNLOAD_ENABLED: 'false' }), 'file-download')).toEqual([]);
  });

  it('fails without SendGrid (nobody could sign up) and without the worker (no e-mail would be sent)', () => {
    expect(level(run(without('SENDGRID_API_KEY')), 'sendgrid')).toEqual(['fail']);
    expect(level(run(without('SENDGRID_FROM_EMAIL')), 'sendgrid')).toEqual(['fail']);
    expect(level(run({ SENDGRID_FROM_EMAIL: 'not an address' }), 'sendgrid')).toEqual(['fail']);
    expect(level(run(without('EMAIL_WORKER_ENABLED')), 'email-worker')).toEqual(['fail']);
    expect(level(run({ EMAIL_WORKER_ENABLED: 'false' }), 'email-worker')).toEqual(['fail']);
  });

  it('warns for the notification and support addresses and for the photo analysis key', () => {
    expect(level(run(without('ADMIN_NOTIFICATION_EMAIL')), 'admin-mail')).toEqual(['warn']);
    expect(level(run(without('SUPPORT_EMAIL')), 'support-mail')).toEqual(['warn']);
    expect(level(run(without('ANTHROPIC_API_KEY')), 'anthropic')).toEqual(['warn']);
    expect(level(run({ ANTHROPIC_API_KEY: '   ' }), 'anthropic')).toEqual(['warn']);
  });

  it('warns when Google or Kakao is off, and fails for a Google id without its secret', () => {
    expect(level(run(without('GOOGLE_CLIENT_ID')), 'google')).toEqual(['warn']);
    expect(level(run(without('KAKAO_CLIENT_ID')), 'kakao')).toEqual(['warn']);
    expect(level(run(without('GOOGLE_CLIENT_SECRET')), 'google')).toEqual(['fail']);
    expect(level(run(without('KAKAO_CLIENT_SECRET')), 'kakao')).toEqual(['ok']);
  });

  it('warns that SENTRY_DSN does nothing', () => {
    expect(level(run({ SENTRY_DSN: 'https://x@sentry.io/1' }), 'sentry')).toEqual(['warn']);
    expect(level(run(), 'sentry')).toEqual([]);
  });
});

describe('the privacy consent', () => {
  it('fails while no version is approved, and says where to approve one', () => {
    const results = run({}, []);

    expect(level(results, 'consent')).toEqual(['fail']);
    expect(results.find(item => item.id === 'consent')!.detail).toContain('APPROVED_CONSENT_VERSIONS');
  });

  it('is fine with an approved version', () => {
    expect(level(run({}, ['2026-v1', '2026-v2']), 'consent')).toEqual(['ok']);
  });
});

describe('config.js of the front end', () => {
  const config = (api: string, version: string): string => `
    var config = Object.freeze({
        API_BASE: '${api}',
        PRIVACY_CONSENT_VERSION: '${version}',
        PRIVACY_CONSENT_URL: 'privacy-consent.html'
    });`;

  it('is not looked at unless it is given', () => {
    expect(run().some(item => item.id.startsWith('front-'))).toBe(false);
  });

  it('is fine with the address of the API and an approved version', () => {
    const results = run({}, APPROVED, config('https://api.example.com', '2026-v1'));

    expect(level(results, 'front-api-base')).toEqual(['ok']);
    expect(level(results, 'front-consent')).toEqual(['ok']);
  });

  it('fails for the development file as it is in the repository', () => {
    const results = run({}, APPROVED, config('http://localhost:4000', 'dev-draft'));

    expect(level(results, 'front-api-base')).toEqual(['fail']);
    expect(level(results, 'front-consent')).toEqual(['fail']);
    expect(results.find(item => item.id === 'front-consent')!.title).toContain('dev-draft');
  });

  it('warns for an API address that differs from PUBLIC_API_URL, and fails for a missing one', () => {
    expect(level(run({}, APPROVED, config('https://other.example.com', '2026-v1')), 'front-api-base')).toEqual(['warn']);
    expect(level(run({}, APPROVED, '// nothing here'), 'front-api-base')).toEqual(['fail']);
    expect(level(run({}, APPROVED, '// nothing here'), 'front-consent')).toEqual(['fail']);
    // A slash at the end does no harm: the pages cut it off before they use the address.
    expect(level(run({}, APPROVED, config('https://api.example.com/', '2026-v1')), 'front-api-base')).toEqual(['ok']);
    expect(level(run({}, APPROVED, config('https://api.example.com/api', '2026-v1')), 'front-api-base')).toEqual(['fail']);
  });

  it('cannot judge the consent version while none is approved', () => {
    expect(level(run({}, [], config('https://api.example.com', '2026-v1')), 'front-consent')).toEqual(['warn']);
  });

  it('is read for the two values only, in single or double quotes', () => {
    expect(readFrontConfig(`API_BASE: "https://a.example.com", PRIVACY_CONSENT_VERSION: '2026-v1'`)).toEqual({
      apiBase: 'https://a.example.com',
      consentVersion: '2026-v1'
    });
    expect(readFrontConfig('')).toEqual({ apiBase: undefined, consentVersion: undefined });
  });
});

describe('what the database says', () => {
  const FILES = ['001_init_schema.ts', '002_admin_sessions.ts', '003_x.js'];
  const answer = (map: Record<string, Array<Record<string, unknown>> | Error>) => async (sql: string) => {
    const key = Object.keys(map).find(part => sql.includes(part));
    const value = key ? map[key] : [];
    if (value instanceof Error) {
      throw value;
    }
    return value;
  };
  const applied = (names: string[]) => names.map(name => ({ name }));
  const ids = (results: CheckResult[]): string => results.map(item => `${item.id}:${item.level}`).join(' ');

  it('is fine when every migration is applied, the prices are there and an admin is ready', async () => {
    const results = await checkDatabaseState(
      answer({
        knex_migrations: applied(['001_init_schema.ts', '002_admin_sessions.ts', '003_x.js']),
        base_prices: [{ n: 5 }],
        admin_users: [{ total: 2, ready: 1 }]
      }),
      FILES
    );

    expect(ids(results)).toBe('migrations:ok base-prices:ok admin-account:ok');
  });

  it('compares migration names whatever the extension (the build has .js, the source .ts)', async () => {
    const results = await checkDatabaseState(answer({ knex_migrations: applied(['001_init_schema.js', '002_admin_sessions.js', '003_x.ts']), base_prices: [{ n: 5 }], admin_users: [{ total: 1, ready: 1 }] }), FILES);

    expect(level(results, 'migrations')).toEqual(['ok']);
  });

  it('fails and names the migrations that are not applied', async () => {
    const results = await checkDatabaseState(answer({ knex_migrations: applied(['001_init_schema.ts']), base_prices: [{ n: 5 }], admin_users: [{ total: 1, ready: 1 }] }), FILES);

    expect(level(results, 'migrations')).toEqual(['fail']);
    expect(results[0].title).toBe('2 migration(s) are not applied: 002_admin_sessions, 003_x');
  });

  it('warns for a database that is ahead of this version', async () => {
    const results = await checkDatabaseState(
      answer({ knex_migrations: applied([...FILES, '099_future.ts']), base_prices: [{ n: 5 }], admin_users: [{ total: 1, ready: 1 }] }),
      FILES
    );

    expect(level(results, 'migrations')).toEqual(['warn']);
  });

  it('stops with a failure when the list of migrations cannot be read', async () => {
    const results = await checkDatabaseState(answer({ knex_migrations: new Error('relation does not exist') }), FILES);

    expect(ids(results)).toBe('migrations:fail');
    expect(JSON.stringify(results)).not.toContain('relation');
  });

  it('warns when the real prices are not there', async () => {
    const results = await checkDatabaseState(answer({ knex_migrations: applied(FILES), base_prices: [{ n: 0 }], admin_users: [{ total: 1, ready: 1 }] }), FILES);

    expect(level(results, 'base-prices')).toEqual(['warn']);
  });

  it('fails without an admin, and warns while none has a password of their own', async () => {
    const base = { knex_migrations: applied(FILES), base_prices: [{ n: 5 }] };

    expect(level(await checkDatabaseState(answer({ ...base, admin_users: [{ total: 0, ready: 0 }] }), FILES), 'admin-account')).toEqual(['fail']);
    expect(level(await checkDatabaseState(answer({ ...base, admin_users: [{ total: 1, ready: 0 }] }), FILES), 'admin-account')).toEqual(['warn']);
  });

  it('does not stop for a table it cannot read after the migrations were listed', async () => {
    const results = await checkDatabaseState(answer({ knex_migrations: applied(FILES), base_prices: new Error('denied'), admin_users: new Error('denied') }), FILES);

    expect(ids(results)).toBe('migrations:ok base-prices:warn admin-account:warn');
  });
});
