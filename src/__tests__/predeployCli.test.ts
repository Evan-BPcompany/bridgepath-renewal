import { PredeployDeps, runPredeployCli } from '../cli/predeployCli';
import { Env } from '../utils/deployCheck';

const GOOD: Env = {
  NODE_ENV: 'production',
  JWT_SECRET: 'q8Zr1vXb4Tn7LmW0yUe3PcA6dHs9GfJk2NoVt5RiBxQlEzMw', // secret-scan:allow
  COOKIE_SECURE: 'true',
  TRUST_PROXY: '1',
  DATABASE_URL: 'postgres://user:pw@db.example.com:5432/bridgepath',
  CORS_ORIGINS: 'https://www.example.com',
  FRONTEND_BASE_URL: 'https://www.example.com',
  PUBLIC_API_URL: 'https://api.example.com',
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

function setup(over: Partial<PredeployDeps> = {}) {
  const lines: string[] = [];
  const errors: string[] = [];
  const files: Record<string, string> = {};
  const deps: PredeployDeps = {
    env: GOOD,
    approvedConsentVersions: ['2026-v1'],
    readFile: path => {
      if (!(path in files)) {
        throw new Error(`no such file ${path}`);
      }
      return files[path];
    },
    parseEnvFile: text => Object.fromEntries(text.split('\n').filter(Boolean).map(line => line.split('=') as [string, string])),
    migrationFiles: () => ['001_a.ts', '002_b.ts'],
    write: line => lines.push(line),
    writeError: line => errors.push(line),
    ...over
  };
  return { deps, lines, errors, files, text: () => lines.join('\n') };
}

describe('npm run predeploy:check', () => {
  it('says "Ready." and exits 0 for a setting that is right', async () => {
    const t = setup();

    const code = await runPredeployCli([], t.deps);

    expect(code).toBe(0);
    expect(t.lines[0]).toBe('Bridge Path: check before deployment');
    expect(t.lines[t.lines.length - 1]).toBe('Ready.');
    expect(t.text()).toMatch(/Result: \d+ ok, 0 warnings, 0 failures\./);
  });

  it('lists the failures first, then the warnings, then the ok ones, and exits 1', async () => {
    const t = setup({ env: { ...GOOD, COOKIE_SECURE: 'false', GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined } });

    const code = await runPredeployCli([], t.deps);

    expect(code).toBe(1);
    const marks = t.lines.filter(line => /^(FAIL|WARN|ok  )/.test(line)).map(line => line.slice(0, 4));
    expect(marks).toEqual([...marks].sort((a, b) => ['FAIL', 'WARN', 'ok  '].indexOf(a) - ['FAIL', 'WARN', 'ok  '].indexOf(b)));
    expect(marks).toContain('FAIL');
    expect(marks).toContain('WARN');
    expect(t.text()).toContain('FAIL  COOKIE_SECURE is not "true"');
    expect(t.text()).toContain('Not ready: fix the failures first.');
  });

  it('says that warnings can be read and exits 0', async () => {
    const t = setup({ env: { ...GOOD, SUPPORT_EMAIL: undefined } });

    expect(await runPredeployCli([], t.deps)).toBe(0);
    expect(t.lines[t.lines.length - 1]).toBe('Ready to start; read the warnings.');
  });

  it('never shows the value of a secret', async () => {
    const t = setup({ env: { ...GOOD, COOKIE_SECURE: 'false' } });

    await runPredeployCli([], t.deps);

    for (const secret of ['aws-secret-value', 'SG.example', 'sk-ant-example', 'google-secret', GOOD.JWT_SECRET!, 'user:pw']) {
      expect(t.text()).not.toContain(secret);
    }
  });

  it('reads the settings from a file when asked, and ignores the environment of the process', async () => {
    const t = setup({ env: { NODE_ENV: 'development' } });
    t.files['prod.env'] = Object.entries(GOOD).map(([key, value]) => `${key}=${value}`).join('\n');

    const code = await runPredeployCli(['--env-file', 'prod.env'], t.deps);

    expect(code).toBe(0);
  });

  it('says so, with exit code 2, for a file that cannot be read or a missing path', async () => {
    const t = setup();

    expect(await runPredeployCli(['--env-file', 'missing.env'], t.deps)).toBe(2);
    expect(t.errors[0]).toBe('The file missing.env could not be read.');
    expect(await runPredeployCli(['--env-file'], t.deps)).toBe(2);
    expect(await runPredeployCli(['--env-file', '--db'], t.deps)).toBe(2);
    expect(await runPredeployCli(['--front', 'nope.js'], t.deps)).toBe(2);
  });

  describe('--front', () => {
    const PROD_CONFIG = "API_BASE: 'https://api.example.com', PRIVACY_CONSENT_VERSION: '2026-v1'";

    it('checks config.js by default, and a path when it is given', async () => {
      const t = setup();
      t.files['config.js'] = PROD_CONFIG;
      t.files['other/config.js'] = "API_BASE: 'http://localhost:4000', PRIVACY_CONSENT_VERSION: 'dev-draft'";

      expect(await runPredeployCli(['--front'], t.deps)).toBe(0);
      expect(await runPredeployCli(['--front', 'other/config.js'], t.deps)).toBe(1);
      expect(t.text()).toContain('API_BASE of config.js is local or not an https address');
    });

    it('takes "--front" followed by another option as "config.js"', async () => {
      const t = setup();
      t.files['config.js'] = PROD_CONFIG;

      expect(await runPredeployCli(['--front', '--help'], t.deps)).toBe(0);
    });
  });

  describe('--db', () => {
    const connectWith = (rows: Record<string, Array<Record<string, unknown>>>, close = jest.fn(async () => undefined)) =>
      jest.fn(async () => ({
        query: async (sql: string) => rows[Object.keys(rows).find(key => sql.includes(key)) ?? ''] ?? [],
        close
      }));

    it('reads the database and closes the connection, also after a failure', async () => {
      const close = jest.fn(async () => undefined);
      const t = setup({
        connect: connectWith({ knex_migrations: [{ name: '001_a.js' }, { name: '002_b.js' }], base_prices: [{ n: 5 }], admin_users: [{ total: 1, ready: 1 }] }, close)
      });

      expect(await runPredeployCli(['--db'], t.deps)).toBe(0);
      expect(close).toHaveBeenCalledTimes(1);
      expect(t.text()).toContain('All 2 migrations are applied');
      expect(t.lines[1]).toContain('and the database');

      const failing = setup({
        connect: async () => ({ query: async () => { throw new Error('boom'); }, close })
      });
      await runPredeployCli(['--db'], failing.deps);
      expect(close).toHaveBeenCalledTimes(2);
    });

    it('fails for a migration that is not applied', async () => {
      const t = setup({ connect: connectWith({ knex_migrations: [{ name: '001_a.js' }], base_prices: [{ n: 5 }], admin_users: [{ total: 1, ready: 1 }] }) });

      expect(await runPredeployCli(['--db'], t.deps)).toBe(1);
      expect(t.text()).toContain('1 migration(s) are not applied: 002_b');
    });

    it('fails without printing the text of a connection error (it can hold the address)', async () => {
      const t = setup({ connect: async () => { throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db.example.com'); } });

      expect(await runPredeployCli(['--db'], t.deps)).toBe(1);
      expect(t.text()).toContain('The database could not be reached');
      expect(t.text()).not.toMatch(/hunter2|ECONNREFUSED/);
    });

    it('fails when there is no DATABASE_URL or no way to connect', async () => {
      const noUrl = setup({ env: { ...GOOD, DATABASE_URL: undefined }, connect: connectWith({}) });
      const noConnect = setup();

      expect(await runPredeployCli(['--db'], noUrl.deps)).toBe(1);
      expect(await runPredeployCli(['--db'], noConnect.deps)).toBe(1);
      expect(noUrl.text()).toContain('The database could not be read');
    });

    it('is not touched without --db', async () => {
      const connect = connectWith({});
      const t = setup({ connect });

      await runPredeployCli([], t.deps);

      expect(connect).not.toHaveBeenCalled();
    });
  });

  it('prints the usage for --help and for an option it does not know', async () => {
    const t = setup();

    expect(await runPredeployCli(['--help'], t.deps)).toBe(0);
    expect(t.lines[0]).toContain('Usage: npm run predeploy:check');
    expect(await runPredeployCli(['--delete-everything'], t.deps)).toBe(2);
    expect(t.errors[0]).toContain('Unknown option: --delete-everything');
  });
});
