import path from 'path';
import knex, { Knex } from 'knex';
import {
  assertSchemaName,
  checkTestDatabaseUrl,
  createSchemaName
} from '../../db/connectionSafety';

// Harness for the integration tests. Every run works in its own schema (it_<random>), so the
// public schema and any other data in the test database are never touched, and the schema
// is dropped afterwards. Nothing here runs unless a suite uses it with a valid
// TEST_DATABASE_URL (see integrationMode.ts).

export const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', '..', 'db', 'migrations');

export interface IsolatedDatabase {
  db: Knex;
  schema: string;
  url: string;
}

// Refuses anything the safety checks do not accept, even if called directly.
export function safeUrl(url: string): string {
  const check = checkTestDatabaseUrl({ ...process.env, TEST_DATABASE_URL: url });
  if (!check.ok) {
    throw new Error(check.message);
  }
  return check.url;
}

export async function createIsolatedDatabase(url: string): Promise<IsolatedDatabase> {
  const connectionString = safeUrl(url);
  const schema = assertSchemaName(createSchemaName());

  const admin = knex({ client: 'pg', connection: { connectionString }, pool: { min: 0, max: 1 } });
  try {
    await admin.raw(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.destroy();
  }

  const db = knex({
    client: 'pg',
    connection: { connectionString },
    searchPath: [schema],
    pool: { min: 0, max: 5 }
  });

  return { db, schema, url: connectionString };
}

export async function dropIsolatedDatabase(isolated: IsolatedDatabase): Promise<void> {
  const schema = assertSchemaName(isolated.schema);
  await isolated.db.destroy();

  const admin = knex({
    client: 'pg',
    connection: { connectionString: safeUrl(isolated.url) },
    pool: { min: 0, max: 1 }
  });
  try {
    await admin.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await admin.destroy();
  }
}

export function migrateLatest(db: Knex): Promise<unknown> {
  return db.migrate.latest({ directory: MIGRATIONS_DIRECTORY, loadExtensions: ['.ts'] });
}

export function migrateDownOne(db: Knex): Promise<unknown> {
  return db.migrate.down({ directory: MIGRATIONS_DIRECTORY, loadExtensions: ['.ts'] });
}

export function rollbackAll(db: Knex): Promise<unknown> {
  return db.migrate.rollback({ directory: MIGRATIONS_DIRECTORY, loadExtensions: ['.ts'] }, true);
}

export interface SchemaSnapshot {
  columns: string[];
  indexes: string[];
  constraints: string[];
}

// The schema name is removed so that snapshots of two different runs can be compared.
export function normalizeSchemaText(text: string, schema: string): string {
  return text.split(`"${schema}".`).join('').split(`${schema}.`).join('');
}

// A comparable description of tables, columns, indexes and constraints of one schema.
export async function snapshotSchema(db: Knex, schema: string): Promise<SchemaSnapshot> {
  assertSchemaName(schema);

  const columns = await db.raw(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name NOT LIKE 'knex_%'
     ORDER BY table_name, column_name`,
    [schema]
  );
  const indexes = await db.raw(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE schemaname = ? AND tablename NOT LIKE 'knex_%'
     ORDER BY tablename, indexname`,
    [schema]
  );
  const constraints = await db.raw(
    `SELECT c.relname AS table_name, k.conname, pg_get_constraintdef(k.oid) AS definition
     FROM pg_constraint k
     JOIN pg_class c ON c.oid = k.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ? AND c.relname NOT LIKE 'knex_%'
     ORDER BY c.relname, k.conname`,
    [schema]
  );

  const normalize = (row: Record<string, unknown>) => normalizeSchemaText(JSON.stringify(row), schema);

  return {
    columns: columns.rows.map(normalize),
    indexes: indexes.rows.map(normalize),
    constraints: constraints.rows.map(normalize)
  };
}
