import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { runPredeployCli } from '../cli/predeployCli';
import { APPROVED_CONSENT_VERSIONS } from '../config/privacyConsent';

// Entry point of `npm run predeploy:check` (compiled to dist/scripts/predeploy-check.js).
// It does not load the application's own configuration (which refuses to load when it is wrong): it
// reads the environment itself, so that it can say what is wrong.
const migrationsDirectory = path.join(__dirname, '..', 'db', 'migrations');

runPredeployCli(process.argv.slice(2), {
  env: process.env,
  approvedConsentVersions: APPROVED_CONSENT_VERSIONS,
  readFile: file => fs.readFileSync(file, 'utf8'),
  parseEnvFile: text => dotenv.parse(text),
  migrationFiles: () => fs.readdirSync(migrationsDirectory).filter(name => /^\d+_.*\.(js|ts)$/.test(name) && !name.endsWith('.d.ts')),
  connect: async env => {
    // The same rule as the application: TLS on, the certificate verified unless it is switched off.
    const ssl = { rejectUnauthorized: (env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false' };
    const client = new Client({ connectionString: env.DATABASE_URL, ssl, connectionTimeoutMillis: 8000 });
    await client.connect();
    return {
      query: async sql => (await client.query(sql)).rows,
      close: () => client.end()
    };
  },
  write: line => {
    process.stdout.write(`${line}\n`);
  },
  writeError: line => {
    process.stderr.write(`${line}\n`);
  }
})
  .then(code => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write('The check failed unexpectedly.\n');
    process.exitCode = 2;
  });
