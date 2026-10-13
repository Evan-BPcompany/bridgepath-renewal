import {
  IsolatedDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  migrateLatest,
  rollbackAll,
  snapshotSchema
} from './helpers/database';
import { describeIntegration } from './helpers/integrationMode';

// Smoke test for the harness itself. It is skipped unless TEST_DATABASE_URL points at a safe
// PostgreSQL 14+ test database on this machine; it has NOT been run yet.
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

    const applied = await isolated.db('knex_migrations').count({ count: '*' }).first();
    expect(Number(applied?.count)).toBe(11);

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
