import type { Knex } from 'knex';
import dotenv from 'dotenv';
import { checkTestDatabaseUrl, requireDatabaseUrl, resolveDatabaseSsl } from './src/db/connectionSafety';

dotenv.config();

// There are no default credentials. Every environment reads its connection lazily, so a
// missing or unsafe URL stops the command with a clear message and nothing connects.

const migrations = {
  directory: './src/db/migrations',
  extension: 'ts',
  loadExtensions: ['.ts']
};

const seeds = {
  directory: './src/db/seeds',
  extension: 'ts',
  loadExtensions: ['.ts']
};

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: () => ({ connectionString: requireDatabaseUrl(process.env, 'DATABASE_URL') }),
    migrations,
    seeds
  },

  production: {
    client: 'pg',
    connection: () => ({
      connectionString: requireDatabaseUrl(process.env, 'DATABASE_URL'),
      // TLS is on by default; DATABASE_SSL / DATABASE_SSL_REJECT_UNAUTHORIZED adjust it
      // (see src/db/connectionSafety.ts). A plaintext connection is refused here.
      ssl: resolveDatabaseSsl(process.env, 'production')
    }),
    migrations,
    seeds,
    pool: {
      min: 2,
      max: 10
    }
  },

  // Only TEST_DATABASE_URL is ever used here, and only when it passes the safety checks.
  test: {
    client: 'pg',
    connection: () => {
      const check = checkTestDatabaseUrl(process.env);
      if (!check.ok) {
        throw new Error(check.message);
      }
      return { connectionString: check.url };
    },
    migrations
  }
};

module.exports = config;
