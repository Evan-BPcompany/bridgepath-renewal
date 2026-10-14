import knex from 'knex';
import { safeUrl } from './database';

// What the test database looks like outside the isolated schema. It is taken before a suite
// creates its schema and compared after the schema is dropped: any difference means a test
// leaked into the public schema (or left a schema behind).
export interface DatabaseShape {
  schemas: string[];
  publicTables: Array<{ name: string; rows: number }>;
}

export async function snapshotDatabaseShape(url: string): Promise<DatabaseShape> {
  const db = knex({ client: 'pg', connection: { connectionString: safeUrl(url) }, pool: { min: 0, max: 1 } });

  try {
    const schemas = await db.raw(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
       ORDER BY nspname`
    );
    const tables = await db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );

    const publicTables: DatabaseShape['publicTables'] = [];
    for (const row of tables.rows as Array<{ table_name: string }>) {
      const count = await db.raw('SELECT count(*)::int AS n FROM ??', [`public.${row.table_name}`]);
      publicTables.push({ name: row.table_name, rows: count.rows[0].n });
    }

    return {
      schemas: (schemas.rows as Array<{ nspname: string }>).map(row => row.nspname),
      publicTables
    };
  } finally {
    await db.destroy();
  }
}

// Empty string when the two shapes are equal, otherwise a description of the difference.
export function describeShapeDifference(before: DatabaseShape, after: DatabaseShape): string {
  const problems: string[] = [];

  const addedSchemas = after.schemas.filter(name => !before.schemas.includes(name));
  const removedSchemas = before.schemas.filter(name => !after.schemas.includes(name));
  if (addedSchemas.length > 0) {
    problems.push(`schemas left behind: ${addedSchemas.join(', ')}`);
  }
  if (removedSchemas.length > 0) {
    problems.push(`schemas that disappeared: ${removedSchemas.join(', ')}`);
  }

  const beforeTables = new Map(before.publicTables.map(table => [table.name, table.rows]));
  for (const table of after.publicTables) {
    if (!beforeTables.has(table.name)) {
      problems.push(`new table in public: ${table.name}`);
    } else if (beforeTables.get(table.name) !== table.rows) {
      problems.push(`row count changed in public.${table.name}: ${beforeTables.get(table.name)} -> ${table.rows}`);
    }
  }
  for (const name of beforeTables.keys()) {
    if (!after.publicTables.some(table => table.name === name)) {
      problems.push(`table removed from public: ${name}`);
    }
  }

  return problems.join('; ');
}
