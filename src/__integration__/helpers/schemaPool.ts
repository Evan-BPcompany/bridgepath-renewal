import { Pool, PoolClient } from 'pg';
import { assertSchemaName } from '../../db/connectionSafety';
import { safeUrl } from './database';

// A pg Pool whose every connection works in ONE isolated schema and nowhere else.
//
//  1. Each physical connection is opened with search_path set to the schema (startup option),
//     plus a statement and lock timeout so a stuck test cannot hang forever.
//  2. Every checkout, through connect() or query(), sets the search_path again before the
//     caller gets the connection. A test (or the code under test) that changed it with
//     SET search_path therefore cannot leak that change to the next user of the connection.
//
// The application code only sees connect() and query(), which is all it uses.
export function createSchemaPool(url: string, schema: string, max = 10): Pool {
  const safeSchema = assertSchemaName(schema);
  const connectionString = safeUrl(url);

  const inner = new Pool({
    connectionString,
    max,
    options: `-c search_path=${safeSchema} -c statement_timeout=30000 -c lock_timeout=15000`
  });
  // An idle connection that the server closes must not crash the test process.
  inner.on('error', () => undefined);

  const acquire = async (): Promise<PoolClient> => {
    const client = await inner.connect();
    try {
      await client.query('SELECT set_config($1, $2, false)', ['search_path', safeSchema]);
    } catch (err) {
      client.release(true);
      throw err;
    }
    return client;
  };

  const facade = {
    connect: acquire,
    query: async (...args: unknown[]) => {
      const client = await acquire();
      try {
        return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        client.release();
      }
    },
    end: () => inner.end()
  };

  return facade as unknown as Pool;
}
