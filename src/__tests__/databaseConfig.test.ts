export {};

// config/database.ts with the pg driver replaced by a mock: nothing connects to a database.
// A fresh copy of the module is loaded per test because it keeps one pool per process.

type Config = typeof import('../config/env').config;

interface Loaded {
  config: Config;
  database: typeof import('../config/database');
  Pool: jest.Mock;
  pool: { query: jest.Mock; end: jest.Mock };
}

// The module is loaded together with its own copy of the config, which the test then adjusts.
function load(databaseUrl?: string): Loaded {
  const pool = { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
  let loaded!: Loaded;

  jest.isolateModules(() => {
    jest.doMock('pg', () => ({ Pool: jest.fn().mockImplementation(() => pool) }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const database = require('../config/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require('../config/env');
    config.databaseUrl = databaseUrl;
    loaded = { config, database, Pool, pool };
  });

  return loaded;
}

describe('database pool configuration (mocked pg)', () => {
  const URL = 'postgres://user:pw@db.example.invalid:5432/app';

  afterEach(() => {
    jest.dontMock('pg');
  });

  it('refuses to create a pool without DATABASE_URL, and says so', () => {
    const { database, Pool } = load(undefined);

    expect(() => database.getPool()).toThrow('DATABASE_URL not set');
    expect(Pool).not.toHaveBeenCalled();
  });

  it('creates the pool from DATABASE_URL with the documented limits', () => {
    const { database, Pool } = load(URL);

    database.getPool();

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://user:pw@db.example.invalid:5432/app',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      })
    );
  });

  it('passes the TLS setting from the config to the pool', () => {
    const verified = load(URL);
    verified.config.databaseSsl = { rejectUnauthorized: true };
    verified.database.getPool();
    expect(verified.Pool).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } })
    );

    const plain = load(URL);
    plain.config.databaseSsl = false;
    plain.database.getPool();
    expect(plain.Pool).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
  });

  it('keeps a single pool for the whole process', () => {
    const { database, Pool } = load(URL);

    expect(database.getPool()).toBe(database.getPool());
    expect(Pool).toHaveBeenCalledTimes(1);
  });

  it('closes the pool and creates a new one afterwards', async () => {
    const { database, Pool, pool } = load(URL);

    database.getPool();
    await database.closePool();
    database.getPool();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledTimes(2);
  });

  it('closing without a pool does nothing', async () => {
    const { database, pool } = load(URL);

    await expect(database.closePool()).resolves.toBeUndefined();
    expect(pool.end).not.toHaveBeenCalled();
  });

  describe('testConnection', () => {
    it('is true when the query answers', async () => {
      const { database, pool } = load(URL);
      pool.query.mockResolvedValue({ rows: [{ now: new Date() }] });

      expect(await database.testConnection()).toBe(true);
      expect(pool.query).toHaveBeenCalledWith('SELECT NOW()');
    });

    it('wraps a failure in a clear error', async () => {
      const { database, pool } = load(URL);
      pool.query.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(database.testConnection()).rejects.toThrow('Database connection test failed: connect ECONNREFUSED');
    });

    it('reports a missing DATABASE_URL the same way', async () => {
      const { database } = load(undefined);

      await expect(database.testConnection()).rejects.toThrow('Database connection test failed: DATABASE_URL not set');
    });
  });
});
