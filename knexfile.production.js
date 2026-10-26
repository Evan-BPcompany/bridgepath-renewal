// The migrations for a SERVER: plain JavaScript, the migrations of the build (dist/db/migrations/*.js),
// and nothing that only a developer's machine has (no ts-node, no TypeScript).
//
//   npm run build
//   npm run db:migrate:prod        applies what is missing
//   npm run db:status:prod         lists what is applied and what is not
//
// knexfile.ts stays the file of the developer's machine (the migrations as TypeScript). The connection rules
// are the same as there (src/db/connectionSafety.ts, compiled): no default database, TLS on, a plain
// connection refused. Heroku runs `db:migrate:prod` before each release (see Procfile).
//
// One rule: a database is migrated either with the TypeScript files (knexfile.ts) or with these compiled
// ones, never both. knex records the file names, and `001_init_schema.ts` is not `001_init_schema.js`.
'use strict';

const fs = require('fs');
const path = require('path');

try {
  // A developer's machine may have a .env; on a server the settings come from the hosting.
  require('dotenv').config();
} catch (error) {
  // dotenv is a dependency of the project, so this is only a half-installed folder: the settings of the
  // environment are used as they are.
}

const migrationsDirectory = path.join(__dirname, 'dist', 'db', 'migrations');

module.exports = {
  production: {
    client: 'pg',
    connection: () => {
      if (!fs.existsSync(migrationsDirectory)) {
        throw new Error('The compiled migrations were not found (dist/db/migrations). Run "npm run build" first. Nothing was changed.');
      }
      const { requireDatabaseUrl, resolveDatabaseSsl } = require('./dist/db/connectionSafety');
      return {
        connectionString: requireDatabaseUrl(process.env, 'DATABASE_URL'),
        ssl: resolveDatabaseSsl(process.env, 'production')
      };
    },
    migrations: {
      directory: migrationsDirectory,
      extension: 'js',
      // The build also holds .d.ts and .map files next to them: only .js are migrations.
      loadExtensions: ['.js']
    },
    pool: { min: 0, max: 2 }
  }
};
