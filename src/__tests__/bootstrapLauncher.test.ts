import fs from 'fs';
import os from 'os';
import path from 'path';
import { builtinModules } from 'module';
import { spawnSync } from 'child_process';
import { cleanChildEnv } from './helpers/cleanEnv';

const root = path.join(__dirname, '..', '..');
const launcher = path.join(root, 'scripts', 'admin-bootstrap.js');
const compiled = path.join(root, 'dist', 'scripts', 'bootstrap-admin.js');
const SECRET_URL = 'postgres://dbuser:SuperSecretDbPw@db.example.invalid:5432/bridgepath';

// Child processes get a scrubbed environment (no DATABASE_URL, AWS or SendGrid values), so a
// developer's own settings are never used.
function run(file: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [file], {
    env: cleanChildEnv(extraEnv),
    input: '',
    encoding: 'utf8',
    timeout: 30000
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

// A throw-away copy of the launcher in a folder layout of our choosing.
function sandbox(distScript?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-launcher-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(launcher, path.join(dir, 'scripts', 'admin-bootstrap.js'));
  if (distScript !== undefined) {
    fs.mkdirSync(path.join(dir, 'dist', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'scripts', 'bootstrap-admin.js'), distScript);
  }
  return { dir, entry: path.join(dir, 'scripts', 'admin-bootstrap.js') };
}

describe('admin:bootstrap launcher and compiled command', () => {
  describe('launcher', () => {
    it('without dist: says to run npm run build, stops with exit code 1, prints no secret', () => {
      const { dir, entry } = sandbox();
      try {
        const result = run(entry, { DATABASE_URL: SECRET_URL });

        expect(result.status).toBe(1);
        expect(result.out).toContain('npm run build');
        expect(result.out).toContain('Nothing was changed.');
        expect(result.out).not.toContain('SuperSecretDbPw');
        expect(result.out).not.toContain('db.example.invalid');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('with dist: runs the compiled script', () => {
      const { dir, entry } = sandbox("process.stdout.write('compiled script ran\\n');");
      try {
        const result = run(entry);

        expect(result.status).toBe(0);
        expect(result.out).toContain('compiled script ran');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('when the compiled script cannot load: prints only an error code, never the message', () => {
      const broken =
        "const e = new Error('connection failed ' + process.env.DATABASE_URL); e.code = 'MODULE_NOT_FOUND'; throw e;";
      const { dir, entry } = sandbox(broken);
      try {
        const result = run(entry, { DATABASE_URL: SECRET_URL });

        expect(result.status).toBe(1);
        expect(result.out).toContain('error code: MODULE_NOT_FOUND');
        expect(result.out).toContain('npm run build');
        expect(result.out).not.toContain('SuperSecretDbPw');
        expect(result.out).not.toContain('connection failed');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('uses only Node built-in modules', () => {
      const source = fs.readFileSync(launcher, 'utf8');
      const required = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);

      expect(required).toEqual(expect.arrayContaining(['fs', 'path']));
      for (const name of required) {
        expect(builtinModules).toContain(name);
      }
    });
  });

  describe('compiled command (needs npm run build first)', () => {
    const compiledIt = fs.existsSync(compiled) ? it : it.skip;

    compiledIt('stops without DATABASE_URL, both through npm\'s launcher and directly', () => {
      for (const file of [launcher, compiled]) {
        const result = run(file);

        expect(result.status).toBe(1);
        expect(result.out).toContain('DATABASE_URL is not set. Aborting; nothing was changed.');
      }
    });

    compiledIt('stops without a terminal and prints nothing from the environment', () => {
      for (const file of [launcher, compiled]) {
        const result = run(file, { DATABASE_URL: SECRET_URL });

        expect(result.status).toBe(1);
        expect(result.out).toContain('interactive terminal');
        expect(result.out).not.toContain('SuperSecretDbPw');
        expect(result.out).not.toContain('dbuser');
        expect(result.out).not.toContain('db.example.invalid');
      }
    });

    compiledIt('does not need ts-node or TypeScript', () => {
      const code = fs.readFileSync(compiled, 'utf8');
      expect(code).not.toMatch(/ts-node|typescript/i);
    });
  });

  describe('static checks (work without a build)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    it('npm script runs plain Node, and the build is a plain tsc', () => {
      expect(pkg.scripts['admin:bootstrap']).toBe('node scripts/admin-bootstrap.js');
      expect(pkg.scripts['admin:bootstrap']).not.toMatch(/ts-node/);
      expect(pkg.scripts.build).toBe('tsc');
      expect(fs.existsSync(path.join(root, 'tsconfig.scripts.json'))).toBe(false);
    });

    it('the entry lives in src/scripts so the normal build emits dist/scripts/bootstrap-admin.js', () => {
      expect(fs.existsSync(path.join(root, 'src', 'scripts', 'bootstrap-admin.ts'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'scripts', 'bootstrap-admin.ts'))).toBe(false);
    });

    it('everything the command imports is a production dependency or a Node built-in', () => {
      const seen = new Set<string>();
      const external = new Set<string>();
      const visit = (file: string) => {
        if (seen.has(file)) {
          return;
        }
        seen.add(file);
        const source = fs.readFileSync(file, 'utf8');
        const specifiers = [
          ...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]),
          ...[...source.matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
        ];
        for (const spec of specifiers) {
          if (spec.startsWith('.')) {
            visit(path.resolve(path.dirname(file), `${spec}.ts`));
          } else {
            external.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
          }
        }
      };
      visit(path.join(root, 'src', 'scripts', 'bootstrap-admin.ts'));

      const dependencies = Object.keys(pkg.dependencies);
      for (const name of external) {
        expect(builtinModules.includes(name) || dependencies.includes(name)).toBe(true);
      }
      expect([...external].sort()).toEqual(expect.arrayContaining(['bcryptjs', 'dotenv', 'pg']));
    });

    it('does not pull in the web server config or the logger (so JWT_SECRET is not required)', () => {
      const files: string[] = [];
      const walk = (file: string) => {
        if (files.includes(file)) {
          return;
        }
        files.push(file);
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
          walk(path.resolve(path.dirname(file), `${m[1]}.ts`));
        }
      };
      walk(path.join(root, 'src', 'scripts', 'bootstrap-admin.ts'));

      const names = files.map(f => path.relative(path.join(root, 'src'), f).replace(/\\/g, '/'));
      expect(names).not.toContain('config/env.ts');
      expect(names).not.toContain('utils/logger.ts');
      expect(names).toEqual(
        expect.arrayContaining(['cli/bootstrapAdminCli.ts', 'services/adminBootstrapService.ts', 'utils/terminalPrompt.ts'])
      );
    });
  });
});
