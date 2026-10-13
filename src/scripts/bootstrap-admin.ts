import 'dotenv/config';
import { Pool } from 'pg';
import { runBootstrapCli } from '../cli/bootstrapAdminCli';
import { createPrompter } from '../utils/terminalPrompt';

// Entry point of `npm run admin:bootstrap` (compiled to dist/scripts/bootstrap-admin.js). Only DATABASE_URL is needed (from the
// environment or .env); the web server's other settings are not required.
runBootstrapCli({
  env: process.env,
  isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  createPrompter: () => createPrompter({ input: process.stdin, output: process.stdout }),
  createPool: databaseUrl => new Pool({ connectionString: databaseUrl, max: 1 }),
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
    process.stderr.write('The bootstrap failed unexpectedly. Nothing was printed to protect secrets.\n');
    process.exitCode = 1;
  });
