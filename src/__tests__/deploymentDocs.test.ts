import fs from 'fs';
import path from 'path';

// The deployment checklist and .env.example have to keep up with the code: a setting that the server reads
// and that neither of them mentions would be found out on the day of the deployment.
const ROOT = path.join(__dirname, '..', '..');
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === '__integration__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

// What the server reads from the environment (the tests and the integration helpers are not the server).
const variablesRead = (): string[] => {
  const names = new Set<string>();
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
};

// Read only by tests and tools, never by the running server.
const NOT_FOR_THE_SERVER = new Set(['TEST_DATABASE_URL', 'REQUIRE_INTEGRATION', 'NODE_ENV']);

describe('the deployment documents and the settings the server reads', () => {
  const checklist = read('docs/DEPLOYMENT-CHECKLIST.md');
  const example = read('.env.example');

  it('finds the settings of the code (a guard against this test checking nothing)', () => {
    const names = variablesRead();

    expect(names.length).toBeGreaterThan(20);
    expect(names).toEqual(expect.arrayContaining(['JWT_SECRET', 'DATABASE_URL', 'SENDGRID_API_KEY', 'FRONTEND_BASE_URL', 'ANTHROPIC_API_KEY']));
  });

  it('has every setting that the server reads in .env.example', () => {
    const missing = variablesRead().filter(name => !NOT_FOR_THE_SERVER.has(name) && !new RegExp(`^#?\\s*${name}=`, 'm').test(example));

    expect(missing).toEqual([]);
  });

  it('has every setting that the server reads in the checklist, except the ones with a sensible default that it names in a group', () => {
    const grouped = new Set(['JWT_EXPIRATION', 'REFRESH_TOKEN_EXPIRATION', 'LOCAL_UPLOAD_DIR', 'EMAIL_WORKER_INTERVAL_MS', 'EMAIL_WORKER_STALE_TIMEOUT_MS', 'LOG_LEVEL', 'PORT', 'DATABASE_SSL']);
    const missing = variablesRead().filter(name => !NOT_FOR_THE_SERVER.has(name) && !grouped.has(name) && !checklist.includes(name));

    expect(missing).toEqual([]);
  });

  it('gives the redirect addresses that the routes really have', () => {
    const routes = read('src/services/oauthProviders.ts');

    expect(routes).toContain('/api/customers/oauth/${provider}/callback');
    expect(checklist).toContain('/api/customers/oauth/google/callback');
    expect(checklist).toContain('/api/customers/oauth/kakao/callback');
  });

  it('names every migration range correctly: the last migration of the code is the one it says', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'src', 'db', 'migrations')).filter(name => /^\d+_/.test(name)).sort();
    const last = migrations[migrations.length - 1].slice(0, 3);

    expect(checklist).toContain(`\`001\` to \`${last}\``);
  });

  it('names the two commands that exist', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;

    expect(scripts['predeploy:check']).toBe('node dist/scripts/predeploy-check.js');
    expect(scripts['front:files']).toBe('node scripts/front-files.js');
    expect(checklist).toContain('npm run predeploy:check');
    expect(checklist).toContain('npm run front:files');
    expect(fs.existsSync(path.join(ROOT, 'src', 'scripts', 'predeploy-check.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'front-files.js'))).toBe(true);
  });

  it('does not contain a secret', () => {
    expect(checklist).not.toMatch(/AKIA[0-9A-Z]{12,}|SG\.[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{10,}|postgres:\/\/[^\s<]+:[^\s<@]+@/);
  });
});
