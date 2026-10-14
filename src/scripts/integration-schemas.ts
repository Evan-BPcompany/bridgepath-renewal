import { Client } from 'pg';
import { runSchemasCli } from '../cli/integrationSchemasCli';

// Entry point of `npm run it:schemas` (compiled to dist/scripts/integration-schemas.js).
// No dotenv on purpose: TEST_DATABASE_URL is read from the environment only.
runSchemasCli(process.argv.slice(2), {
  env: process.env,
  createClient: async connectionString => {
    const client = new Client({ connectionString });
    await client.connect();
    return client;
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
    process.stderr.write('The command failed unexpectedly.\n');
    process.exitCode = 1;
  });
