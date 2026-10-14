import { Pool } from 'pg';
import type { Knex } from 'knex';
import { getPool } from '../../config/database';
import {
  IsolatedDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  migrateLatest
} from './database';
import { describeShapeDifference, snapshotDatabaseShape } from './databaseShape';
import { createSchemaPool } from './schemaPool';

export interface SuiteDatabase {
  url: string;
  schema: string;
  // knex bound to the schema: for DDL, fixtures and assertions.
  db: Knex;
  // The pool the application code receives from getPool().
  pool: Pool;
}

// Accepts only a PostgreSQL 14+ server on this machine whose database name contains "test".
// Runs on a connection that already passed the URL checks; this is the second line of defence.
export async function assertSafeServer(db: Knex): Promise<void> {
  const result = await db.raw(
    `SELECT current_database() AS database,
            host(inet_server_addr()) AS address,
            current_setting('server_version_num')::int AS version`
  );
  const { database, address, version } = result.rows[0] as {
    database: string;
    address: string | null;
    version: number;
  };

  if (!/test/i.test(database)) {
    throw new Error(`Connected database "${database}" does not contain "test"; refusing to continue.`);
  }
  // address is null for a Unix socket, which is local by definition.
  if (address !== null && address !== '127.0.0.1' && address !== '::1') {
    throw new Error(`Connected to a non-local server address (${address}); refusing to continue.`);
  }
  if (version < 140000) {
    throw new Error(`PostgreSQL ${version} is too old; version 14 or newer is required.`);
  }
}

// getPool() must be replaced by the test file (jest.mock('../config/database', ...)). If it were
// not, the application would build a pool from the regular database setting, which tests must never use.
export function bindApplicationPool(pool: Pool): void {
  if (!jest.isMockFunction(getPool)) {
    throw new Error(
      "The test file must start with jest.mock('../config/database', () => ({ getPool: jest.fn() })); " +
        'otherwise the application would connect to the regular (non-test) database.'
    );
  }
  (getPool as jest.Mock).mockReturnValue(pool);
}

// Registers beforeAll/afterAll for one test file: its own schema, migrated (unless told
// otherwise), a schema-bound pool wired into getPool(), and a check at the end that the
// schema is gone and that nothing else in the database changed. Call inside describeIntegration.
export function useIsolatedSchema(
  url: string,
  options: { migrate?: boolean } = {}
): () => SuiteDatabase {
  let isolated: IsolatedDatabase | undefined;
  let pool: Pool | undefined;
  let before: Awaited<ReturnType<typeof snapshotDatabaseShape>> | undefined;

  beforeAll(async () => {
    before = await snapshotDatabaseShape(url);
    isolated = await createIsolatedDatabase(url);
    await assertSafeServer(isolated.db);
    if (options.migrate !== false) {
      await migrateLatest(isolated.db);
    }
    pool = createSchemaPool(url, isolated.schema);
    bindApplicationPool(pool);
  }, 120000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (isolated) {
      await dropIsolatedDatabase(isolated);
    }
    if (before) {
      const after = await snapshotDatabaseShape(url);
      const difference = describeShapeDifference(before, after);
      if (difference !== '') {
        throw new Error(`The test run changed the database outside its schema: ${difference}`);
      }
    }
  }, 120000);

  return () => {
    if (!isolated || !pool) {
      throw new Error('The isolated schema is not ready: only call this inside a test or hook.');
    }
    return { url, schema: isolated.schema, db: isolated.db, pool };
  };
}
