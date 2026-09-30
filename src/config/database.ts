import { Pool, PoolConfig } from 'pg';
import { config } from './env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error(
        'DATABASE_URL not set. Please set DATABASE_URL in .env file to connect to the database.'
      );
    }

    const poolConfig: PoolConfig = {
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    };

    pool = new Pool(poolConfig);
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const poolInstance = getPool();
    const result = await poolInstance.query('SELECT NOW()');
    return !!result;
  } catch (err) {
    throw new Error(
      `Database connection test failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
