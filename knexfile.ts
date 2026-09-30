import type { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'bridgepath_dev'
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'sql',
      loadExtensions: ['.sql'],
      stub: 'migrations/stubs/migration.stub'
    },
    seeds: {
      directory: './src/db/seeds',
      extension: 'ts',
      loadExtensions: ['.ts']
    }
  },

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'sql',
      loadExtensions: ['.sql']
    },
    seeds: {
      directory: './src/db/seeds',
      extension: 'ts',
      loadExtensions: ['.ts']
    },
    pool: {
      min: 2,
      max: 10
    }
  },

  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'bridgepath_test'
    },
    migrations: {
      directory: './src/db/migrations',
      extension: 'sql',
      loadExtensions: ['.sql']
    }
  }
};

module.exports = config;
