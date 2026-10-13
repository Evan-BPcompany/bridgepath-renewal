import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { cleanChildEnv } from './helpers/cleanEnv';

const root = path.join(__dirname, '..', '..');
const scriptPath = path.join(root, 'scripts', 'setup-db.sh');

// The script is started with a scrubbed environment and fake values. Every case below is
// refused in check_env, before psql or knex are ever called, so nothing connects.
function runScript(extraEnv: Record<string, string> = {}) {
  const result = spawnSync('bash', ['scripts/setup-db.sh'], {
    cwd: root,
    env: cleanChildEnv(extraEnv),
    encoding: 'utf8',
    timeout: 30000
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe('scripts/setup-db.sh has no default database', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('has no default user, password or localhost URL', () => {
    expect(source).not.toMatch(/postgres:postgres/);
    expect(source).not.toMatch(/localhost:5432/);
    expect(source).not.toMatch(/using local PostgreSQL/);
  });

  it('no longer claims that the seeded master has a usable default password', () => {
    expect(source).not.toContain('CHANGE_ME_ON_FIRST_LOGIN');
    expect(source).toContain('npm run admin:bootstrap');
  });

  it('checks DATABASE_URL before it looks for psql', () => {
    expect(source.indexOf('DATABASE_URL is not set')).toBeGreaterThan(-1);
    expect(source.indexOf('DATABASE_URL is not set')).toBeLessThan(source.indexOf('command -v psql'));
  });

  it('has valid bash syntax', () => {
    const result = spawnSync('bash', ['-n', 'scripts/setup-db.sh'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('stops without DATABASE_URL and changes nothing', () => {
    const result = runScript();

    expect(result.status).toBe(1);
    expect(result.out).toContain('DATABASE_URL is not set. Set it explicitly (there is no default database). Nothing was changed.');
    expect(result.out).not.toContain('Running Database Migrations');
  });

  it('setup script: treats a blank DATABASE_URL as missing', () => {
    const result = runScript({ DATABASE_URL: '' });

    expect(result.status).toBe(1);
    expect(result.out).toContain('DATABASE_URL is not set');
  });

  it('refuses DATABASE_URL equal to TEST_DATABASE_URL, without printing either', () => {
    const url = 'postgres://tester:SuperSecretDbPw@127.0.0.1:5432/app_test';
    const result = runScript({ DATABASE_URL: url, TEST_DATABASE_URL: url });

    expect(result.status).toBe(1);
    expect(result.out).toContain('DATABASE_URL and TEST_DATABASE_URL must not be the same. Nothing was changed.');
    expect(result.out).not.toContain('SuperSecretDbPw');
    expect(result.out).not.toContain('Running Database Migrations');
  });
});
