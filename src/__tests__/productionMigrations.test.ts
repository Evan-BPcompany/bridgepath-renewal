import fs from 'fs';
import path from 'path';

// What a server needs to migrate its own database: knex among the dependencies that stay (the hosting removes
// the development ones after the build), a knexfile in plain JavaScript that reads the compiled migrations,
// and a release step that runs it.
const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const knexfileSource = fs.readFileSync(path.join(ROOT, 'knexfile.production.js'), 'utf8');

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('the dependencies that a server keeps', () => {
  it('has knex, pg and dotenv among the dependencies, not only the development ones', () => {
    for (const name of ['knex', 'pg', 'dotenv']) {
      expect(pkg.dependencies[name]).toBeDefined();
      expect(pkg.devDependencies[name]).toBeUndefined();
    }
  });

  it('does not need ts-node or TypeScript to migrate: the knexfile is JavaScript and loads nothing from them', () => {
    const code = knexfileSource.replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/ts-node|typescript|\.ts['"]|register/i);
    expect(pkg.scripts['db:migrate:prod']).toBe('knex migrate:latest --knexfile knexfile.production.js --env production');
    expect(pkg.scripts['db:status:prod']).toBe('knex migrate:list --knexfile knexfile.production.js --env production');
  });
});

describe('the Procfile', () => {
  const procfile = fs.readFileSync(path.join(ROOT, 'Procfile'), 'utf8').split(/\r?\n/).filter(Boolean);

  it('starts the web process and migrates before each release', () => {
    expect(procfile).toEqual(['web: npm start', 'release: npm run db:migrate:prod']);
  });

  it('uses scripts that exist', () => {
    expect(pkg.scripts.start).toBe('node dist/index.js');
    expect(pkg.scripts['db:migrate:prod']).toBeDefined();
  });
});

describe('knexfile.production.js', () => {
  // The compiled helpers are replaced, so that this does not depend on a build and never connects.
  function load(over: { exists?: boolean } = {}) {
    jest.doMock('../../dist/db/connectionSafety', () => ({
      requireDatabaseUrl: (env: Record<string, string | undefined>, name: string) => {
        if (!env[name]) {
          throw new Error(`${name} is not set`);
        }
        return env[name];
      },
      resolveDatabaseSsl: (_env: unknown, nodeEnv: string) => ({ rejectUnauthorized: nodeEnv === 'production' ? false : true, forEnvironment: nodeEnv })
    }), { virtual: true });
    if (over.exists !== undefined) {
      const real = fs.existsSync;
      jest.spyOn(fs, 'existsSync').mockImplementation(file => (String(file).endsWith(path.join('dist', 'db', 'migrations')) ? over.exists! : real(file)));
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../knexfile.production.js').production;
  }

  it('has only the production environment: a PostgreSQL client and the compiled migrations as .js', () => {
    const config = load();

    expect(config.client).toBe('pg');
    expect(config.migrations.directory).toBe(path.join(ROOT, 'dist', 'db', 'migrations'));
    expect(config.migrations.loadExtensions).toEqual(['.js']);
    expect(config.migrations.extension).toBe('js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(Object.keys(require('../../knexfile.production.js'))).toEqual(['production']);
  });

  it('connects with the address of DATABASE_URL and the TLS of the production rules, and with nothing else', () => {
    const config = load({ exists: true });
    process.env.DATABASE_URL = 'postgres://u:p@db.example.com:5432/x';

    try {
      expect(config.connection()).toEqual({
        connectionString: 'postgres://u:p@db.example.com:5432/x',
        ssl: { rejectUnauthorized: false, forEnvironment: 'production' }
      });
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it('has no default database: without DATABASE_URL it stops', () => {
    const config = load({ exists: true });
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => config.connection()).toThrow('DATABASE_URL is not set');
    } finally {
      if (saved !== undefined) {
        process.env.DATABASE_URL = saved;
      }
    }
  });

  it('says to build first when the compiled migrations are not there, before it asks for any setting', () => {
    const config = load({ exists: false });

    expect(() => config.connection()).toThrow('Run "npm run build" first');
  });

  it('does not open a pool of its own beyond two connections', () => {
    expect(load().pool).toEqual({ min: 0, max: 2 });
  });
});
