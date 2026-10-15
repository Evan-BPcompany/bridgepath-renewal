import fs from 'fs';
import {
  IsolatedDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  MIGRATIONS_DIRECTORY,
  migrateLatest,
  rollbackAll,
  snapshotSchema
} from './helpers/database';
import { describeIntegration } from './helpers/integrationMode';

// Smoke test for the harness itself. It is skipped unless TEST_DATABASE_URL points at a safe
// PostgreSQL 14+ test database on this machine.
describeIntegration('integration harness', ({ url }) => {
  let isolated: IsolatedDatabase;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase(url);
  });

  afterAll(async () => {
    await dropIsolatedDatabase(isolated);
  });

  it('applies every migration inside its own schema', async () => {
    await migrateLatest(isolated.db);

    // The expected migrations are the numbered files in the migrations folder, so adding a
    // migration does not need an edit here.
    const files = fs
      .readdirSync(MIGRATIONS_DIRECTORY)
      .filter(name => /^\d{3}_.+\.ts$/.test(name))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const applied = await isolated.db('knex_migrations').orderBy('id').select('name');
    expect(applied.map((row: { name: string }) => row.name)).toEqual(files);

    const snapshot = await snapshotSchema(isolated.db, isolated.schema);
    expect(snapshot.columns.length).toBeGreaterThan(0);
    expect(snapshot.constraints.join('\n')).toContain('estimates_contact_required');
  });

  it('rolls everything back and leaves no application tables', async () => {
    await rollbackAll(isolated.db);

    const snapshot = await snapshotSchema(isolated.db, isolated.schema);
    expect(snapshot.columns).toEqual([]);
    expect(snapshot.indexes).toEqual([]);
    expect(snapshot.constraints).toEqual([]);
  });
});
