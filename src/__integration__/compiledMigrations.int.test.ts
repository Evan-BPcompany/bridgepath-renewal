jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { migrateLatest, rollbackAll, snapshotSchema } from './helpers/database';

const ROOT = path.join(__dirname, '..', '..');

// What a server runs: the migrations of the BUILD (dist/db/migrations/*.js), through knexfile.production.js,
// instead of the TypeScript files of the developer's machine. They have to make the same database.
// The build is made here, so that this tests the code as it is now and not an old build.
describeIntegration('the compiled migrations (knexfile.production.js)', ({ url }) => {
  const suite = useIsolatedSchema(url, { migrate: false });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { production } = require('../../knexfile.production.js');
  const compiled = { directory: production.migrations.directory as string, loadExtensions: production.migrations.loadExtensions as string[] };
  const sourceFiles = fs.readdirSync(path.join(ROOT, 'src', 'db', 'migrations')).filter(name => /^\d+_.*\.ts$/.test(name)).sort();

  beforeAll(() => {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 240000 });
  }, 260000);

  it('are the migrations of the source, one for one, as .js files', () => {
    const built = fs.readdirSync(compiled.directory).filter(name => /^\d+_.*\.js$/.test(name)).sort();

    expect(built).toEqual(sourceFiles.map(name => name.replace(/\.ts$/, '.js')));
    expect(built.length).toBeGreaterThanOrEqual(18);
  });

  it('make the same database as the TypeScript ones (tables, columns, indexes, constraints), and roll back', async () => {
    const db = suite().db;

    await migrateLatest(db);
    const fromSource = await snapshotSchema(db, suite().schema);
    await rollbackAll(db);
    expect((await db('knex_migrations').count({ n: '*' }).first())?.n).toBe('0');

    const applied = (await db.migrate.latest(compiled)) as [number, string[]];
    expect(applied[1]).toEqual(sourceFiles.map(name => name.replace(/\.ts$/, '.js')));
    expect(await snapshotSchema(db, suite().schema)).toEqual(fromSource);

    // The list says everything is applied, and a second run changes nothing.
    const [done, pending] = (await db.migrate.list(compiled)) as [Array<{ name: string }>, unknown[]];
    expect(done.map(item => item.name)).toEqual(applied[1]);
    expect(pending).toEqual([]);
    expect(((await db.migrate.latest(compiled)) as [number, string[]])[1]).toEqual([]);

    await db.migrate.rollback(compiled, true);
    expect((await db('knex_migrations').count({ n: '*' }).first())?.n).toBe('0');
  });

  it('refuse a database that was migrated with the TypeScript files: the names differ, and nothing is changed', async () => {
    const db = suite().db;
    await migrateLatest(db);

    await expect(db.migrate.latest(compiled)).rejects.toThrow(/migration directory is corrupt/i);

    expect((await db('knex_migrations').count({ n: '*' }).first())?.n).toBe(String(sourceFiles.length));
    expect((await db('knex_migrations').first())?.name).toMatch(/\.ts$/);
    await rollbackAll(db);
  });
});
