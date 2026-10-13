import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolveIntegrationMode } from '../__integration__/helpers/integrationMode';
import { normalizeSchemaText } from '../__integration__/helpers/database';
import { cleanChildEnv } from './helpers/cleanEnv';

const root = path.join(__dirname, '..', '..');
const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
const LOCAL_TEST = 'postgres://tester:SuperSecretDbPw@127.0.0.1:5432/bridgepath_test';

// Starts the integration test run in a child process. The child gets a scrubbed environment
// (no real DATABASE_URL, AWS or SendGrid values). Every scenario below either has no
// database configured or is refused by the safety checks before any connection is made.
function runIntegration(extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [jestBin, '--config', 'jest.integration.config.js', '--runInBand', '--ci'], {
    cwd: root,
    env: cleanChildEnv(extraEnv),
    encoding: 'utf8',
    timeout: 120000
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('integration test harness: mode selection (pure logic)', () => {
  it('is enabled only for a safe local test database', () => {
    expect(resolveIntegrationMode({ TEST_DATABASE_URL: LOCAL_TEST })).toEqual({
      kind: 'enabled',
      url: LOCAL_TEST,
      description: '127.0.0.1:5432/bridgepath_test'
    });
  });

  it('is skipped when TEST_DATABASE_URL is not set', () => {
    expect(resolveIntegrationMode({})).toMatchObject({ kind: 'skipped' });
    expect(resolveIntegrationMode({ REQUIRE_INTEGRATION: 'false' })).toMatchObject({ kind: 'skipped' });
    expect(resolveIntegrationMode({ REQUIRE_INTEGRATION: '1' })).toMatchObject({ kind: 'skipped' });
  });

  it('is never enabled by DATABASE_URL alone', () => {
    expect(resolveIntegrationMode({ DATABASE_URL: LOCAL_TEST })).toMatchObject({ kind: 'skipped' });
  });

  it('fails when REQUIRE_INTEGRATION=true and no database is configured', () => {
    const mode = resolveIntegrationMode({ REQUIRE_INTEGRATION: 'true' });

    expect(mode).toMatchObject({ kind: 'required-missing' });
    expect(JSON.stringify(mode)).toContain('REQUIRE_INTEGRATION=true but TEST_DATABASE_URL is not set');
  });

  it.each([
    ['the same database as DATABASE_URL', { TEST_DATABASE_URL: LOCAL_TEST, DATABASE_URL: LOCAL_TEST }],
    ['a remote host', { TEST_DATABASE_URL: 'postgres://u:SuperSecretDbPw@db.example.invalid/app_test' }],
    ['a name without "test"', { TEST_DATABASE_URL: 'postgres://u:SuperSecretDbPw@127.0.0.1/app_dev' }],
    ['an invalid URL', { TEST_DATABASE_URL: 'garbage' }]
  ])('always fails for %s, even without REQUIRE_INTEGRATION', (_name, env) => {
    const mode = resolveIntegrationMode(env);

    expect(mode.kind).toBe('invalid');
    expect(JSON.stringify(mode)).not.toContain('SuperSecretDbPw');
  });
});

describe('integration test harness: helpers', () => {
  it('removes the schema name from catalog text so two runs can be compared', () => {
    const text = 'CREATE INDEX idx ON "it_0123abcd".estimates USING btree (status) -- it_0123abcd.estimates';

    expect(normalizeSchemaText(text, 'it_0123abcd')).toBe('CREATE INDEX idx ON estimates USING btree (status) -- estimates');
  });

  it('keeps the integration suites out of npm test and in their own config', () => {
    const unit = require('../../jest.config.js');
    const integration = require('../../jest.integration.config.js');

    expect(unit.testMatch).toEqual(['**/__tests__/**/*.test.ts']);
    expect(integration.testMatch).toEqual(['**/__integration__/**/*.int.test.ts']);
    expect(integration.setupFiles).toEqual(unit.setupFiles);
    expect(integration.maxWorkers).toBe(1);

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('jest');
    expect(pkg.scripts['test:integration']).toBe('jest --config jest.integration.config.js --runInBand');
  });

  it('only touches the database through the harness, whose entry points re-check the URL', () => {
    const source = fs.readFileSync(path.join(root, 'src', '__integration__', 'helpers', 'database.ts'), 'utf8');

    expect(source).toContain('checkTestDatabaseUrl');
    expect(source).not.toMatch(/process\.env\.DATABASE_URL/);
  });
});

describe('integration test harness: a real run in a child process', () => {
  it('is disabled by default: suites are skipped and the run succeeds', () => {
    const result = runIntegration();

    expect(result.status).toBe(0);
    expect(result.out).toMatch(/skipped/i);
    expect(result.out).toMatch(/Tests:\s+\d+ skipped/);
    expect(result.out).not.toMatch(/failed/i);
  }, 120000);

  it('fails when REQUIRE_INTEGRATION=true and TEST_DATABASE_URL is missing', () => {
    const result = runIntegration({ REQUIRE_INTEGRATION: 'true' });

    expect(result.status).not.toBe(0);
    expect(result.out).toContain('REQUIRE_INTEGRATION=true but TEST_DATABASE_URL is not set');
  }, 120000);

  it('fails, without connecting, when TEST_DATABASE_URL is the same database as DATABASE_URL', () => {
    const result = runIntegration({ TEST_DATABASE_URL: LOCAL_TEST, DATABASE_URL: LOCAL_TEST });

    expect(result.status).not.toBe(0);
    expect(result.out).toContain('TEST_DATABASE_URL must not be the same database as DATABASE_URL.');
    expect(result.out).not.toContain('SuperSecretDbPw');
  }, 120000);

  it('fails, without connecting, for a remote database host', () => {
    const result = runIntegration({ TEST_DATABASE_URL: 'postgres://tester:SuperSecretDbPw@db.example.invalid:5432/app_test' });

    expect(result.status).not.toBe(0);
    expect(result.out).toContain('remote host');
    expect(result.out).not.toContain('SuperSecretDbPw');
  }, 120000);
});
