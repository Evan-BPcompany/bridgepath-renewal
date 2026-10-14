jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';

// The isolation itself: every connection the application can get works in the test schema,
// a changed search_path does not leak to the next user of a connection, and nothing is
// created in the public schema. (The check that public is untouched after the whole run is
// part of useIsolatedSchema; it fails the suite in afterAll.)
describeIntegration('schema isolation', ({ url }) => {
  const suite = useIsolatedSchema(url);

  const currentSchemaOf = async (client: PoolClient) =>
    (await client.query<{ schema: string; path: string }>("SELECT current_schema() AS schema, current_setting('search_path') AS path")).rows[0];

  it('getPool() returns the schema-bound pool, not a pool built from the regular database setting', () => {
    expect(jest.isMockFunction(getPool)).toBe(true);
    expect(getPool()).toBe(suite().pool);
  });

  it('every one of many concurrent connections uses the test schema', async () => {
    const { pool, schema } = suite();

    const clients = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map(client => currentSchemaOf(client)));
      for (const result of results) {
        expect(result.schema).toBe(schema);
        expect(result.path).toBe(schema);
      }
    } finally {
      clients.forEach(client => client.release());
    }
  });

  it('pool.query() also runs in the test schema', async () => {
    const { pool, schema } = suite();

    const result = await pool.query('SELECT current_schema() AS schema');
    expect(result.rows[0].schema).toBe(schema);
  });

  it('a search_path changed by one user is reset before the connection is handed out again', async () => {
    const { pool, schema } = suite();

    // Pollute every connection the pool can hold, then give them all back.
    const polluted = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    for (const client of polluted) {
      await client.query('SET search_path TO public');
      expect((await currentSchemaOf(client)).schema).toBe('public');
    }
    polluted.forEach(client => client.release());

    // Reused connections must be clean again, whichever way they are taken.
    for (let i = 0; i < 25; i += 1) {
      const client = await pool.connect();
      try {
        expect((await currentSchemaOf(client)).schema).toBe(schema);
      } finally {
        client.release();
      }
      expect((await pool.query('SELECT current_schema() AS schema')).rows[0].schema).toBe(schema);
    }
  });

  it('an unqualified CREATE TABLE lands in the test schema and never in public', async () => {
    const { pool, db, schema } = suite();

    await pool.query('CREATE TABLE isolation_probe (id int)');
    await pool.query('INSERT INTO isolation_probe VALUES (1)');

    const where = await db.raw(
      `SELECT table_schema FROM information_schema.tables WHERE table_name = 'isolation_probe'`
    );
    expect(where.rows.map((row: { table_schema: string }) => row.table_schema)).toEqual([schema]);

    await pool.query('DROP TABLE isolation_probe');
  });

  it('the knex connection of the harness is bound to the schema as well', async () => {
    const { db, schema } = suite();

    const result = await db.raw('SELECT current_schema() AS schema');
    expect(result.rows[0].schema).toBe(schema);
  });

  it('is connected to a local PostgreSQL 14+ test database', async () => {
    const { db } = suite();

    const result = await db.raw(
      `SELECT current_database() AS database, current_setting('server_version_num')::int AS version`
    );
    expect(result.rows[0].database).toMatch(/test/i);
    expect(result.rows[0].version).toBeGreaterThanOrEqual(140000);
  });
});
