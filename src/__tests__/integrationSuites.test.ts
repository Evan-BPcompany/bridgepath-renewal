import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { cleanChildEnv } from './helpers/cleanEnv';

const root = path.join(__dirname, '..', '..');
const integrationDir = path.join(root, 'src', '__integration__');
const suites = fs.readdirSync(integrationDir).filter(file => file.endsWith('.int.test.ts'));

const EXPECTED_SUITES = [
  'adminAuth',
  'adminEstimates',
  'emailOutbox',
  'estimates',
  'estimatesFiles',
  'harness',
  'isolation',
  'migrations',
  'passwordChange',
  'receiptSequence'
];

describe('integration suites: what they may and may not do (no database needed)', () => {
  it('there are the ten expected suites', () => {
    expect(suites.map(file => file.replace('.int.test.ts', '')).sort()).toEqual(EXPECTED_SUITES);
  });

  it.each(suites)('%s only runs through describeIntegration, so it is skipped without a database', file => {
    const source = fs.readFileSync(path.join(integrationDir, file), 'utf8');

    expect(source).toContain('describeIntegration(');
    // No top-level describe() that would run without TEST_DATABASE_URL.
    expect(source).not.toMatch(/^describe(\.only)?\(/m);
  });

  it.each(suites.filter(file => file !== 'harness.int.test.ts'))(
    '%s replaces getPool() so the application can never build a pool from DATABASE_URL',
    file => {
      const source = fs.readFileSync(path.join(integrationDir, file), 'utf8');

      expect(source).toMatch(/^jest\.mock\('\.\.\/config\/database', \(\) => \(\{ getPool: jest\.fn\(\) \}\)\);/m);
    }
  );

  it('no integration file reads DATABASE_URL or contains an AWS/SendGrid credential', () => {
    for (const file of fs.readdirSync(integrationDir, { recursive: true }) as string[]) {
      if (!file.endsWith('.ts')) {
        continue;
      }
      const source = fs.readFileSync(path.join(integrationDir, file), 'utf8');
      const withoutComments = source.replace(/\/\/.*$/gm, '');

      expect(withoutComments).not.toMatch(/(?<![A-Z_])DATABASE_URL/);
      expect(withoutComments).not.toMatch(/AWS_ACCESS|AWS_SECRET|SENDGRID_API_KEY/);
    }
  });

  it('every suite that sends mail replaces the SendGrid client', () => {
    const source = fs.readFileSync(path.join(integrationDir, 'emailOutbox.int.test.ts'), 'utf8');

    expect(source).toContain("jest.mock('@sendgrid/mail'");
  });

  it('the default test run does not pick the integration suites up', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../jest.config.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const integration = require('../../jest.integration.config.js');

    expect(config.testMatch).toEqual(['**/__tests__/**/*.test.ts']);
    expect(integration.testMatch).toEqual(['**/__integration__/**/*.int.test.ts']);
    expect(integration.maxWorkers).toBe(1);
    expect(integration.setupFiles).toEqual(config.setupFiles);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scripts = require('../../package.json').scripts;
    expect(scripts.test).toBe('jest');
    expect(scripts['test:integration']).toContain('jest.integration.config.js');
  });
});

// Starts the integration config in a child process with a scrubbed environment. Every case
// below is decided before any connection is attempted (skipped, or refused by the URL
// checks), so nothing can connect to anything.
describe('npm run test:integration without a usable database (child process)', () => {
  function runIntegration(extraEnv: Record<string, string> = {}) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'node_modules', 'jest', 'bin', 'jest.js'), '--config', 'jest.integration.config.js', '--runInBand'],
      { cwd: root, env: cleanChildEnv(extraEnv), encoding: 'utf8', timeout: 240000 }
    );
    return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
  }

  it('skips every suite and succeeds when nothing is configured', () => {
    const { status, out } = runIntegration();

    expect(out).toMatch(/Tests:\s+\d+ skipped/);
    expect(out).not.toMatch(/\d+ failed/);
    expect(status).toBe(0);
  }, 300000);

  it('fails when REQUIRE_INTEGRATION=true but no database is configured', () => {
    const { status, out } = runIntegration({ REQUIRE_INTEGRATION: 'true' });

    expect(status).toBe(1);
    expect(out).toContain('REQUIRE_INTEGRATION=true but TEST_DATABASE_URL is not set');
  }, 300000);

  it('fails, without connecting, for a remote database', () => {
    const { status, out } = runIntegration({ TEST_DATABASE_URL: 'postgres://u:p@db.example.invalid:5432/app_test' });

    expect(status).toBe(1);
    expect(out).toContain('remote host');
    expect(out).not.toContain('u:p@');
  }, 300000);

  it('fails for a database whose name does not contain "test"', () => {
    const { status, out } = runIntegration({ TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/production' });

    expect(status).toBe(1);
    expect(out).toContain('does not contain "test"');
  }, 300000);

  it('fails when TEST_DATABASE_URL is the same database as DATABASE_URL', () => {
    const same = 'postgres://u:p@127.0.0.1:5432/app_test';
    const { status, out } = runIntegration({ TEST_DATABASE_URL: same, DATABASE_URL: same });

    expect(status).toBe(1);
    expect(out).toContain('must not be the same database as DATABASE_URL');
  }, 300000);
});
