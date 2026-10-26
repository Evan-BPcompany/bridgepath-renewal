import { CheckResult, Env, Query, checkDatabaseState, checkDeployment, summarize } from '../utils/deployCheck';

// `npm run predeploy:check [-- --env-file <path>] [--front [config.js]] [--db]`
//
// Reads the settings of a deployment and says what is wrong before the deployment, in the words of the
// checklist (docs/DEPLOYMENT-CHECKLIST.md). By default it touches nothing but the files it is told to
// read; with --db it connects to DATABASE_URL and only reads (the migrations, the prices, the admin
// accounts). Secrets are never printed. Exit code 1 when anything fails.

export interface PredeployDeps {
  // The environment of the process (what the hosting gives to the server).
  env: Env;
  approvedConsentVersions: readonly string[];
  readFile: (path: string) => string;
  parseEnvFile: (text: string) => Env;
  // The names of the migration files of this version.
  migrationFiles: () => string[];
  // Opens the database of --db: undefined when it cannot be done here.
  connect?: (env: Env) => Promise<{ query: Query; close: () => Promise<void> }>;
  write: (line: string) => void;
  writeError: (line: string) => void;
}

const USAGE = [
  'Usage: npm run predeploy:check -- [options]',
  '  --env-file <path>   read the settings from a file (as .env) instead of the environment of this process',
  '  --front [path]      also check the config.js of the front end (default: config.js)',
  '  --db                also read the database of DATABASE_URL (migrations, prices, admin accounts); reading only',
  '  --help              this text'
].join('\n');

const LABEL: Record<CheckResult['level'], string> = { fail: 'FAIL', warn: 'WARN', ok: 'ok  ' };

export async function runPredeployCli(args: string[], deps: PredeployDeps): Promise<number> {
  let envFile: string | undefined;
  let front: string | undefined;
  let withDatabase = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      deps.write(USAGE);
      return 0;
    }
    if (arg === '--env-file') {
      envFile = args[i + 1];
      i += 1;
      if (!envFile || envFile.startsWith('--')) {
        deps.writeError('--env-file needs the path of a file.');
        return 2;
      }
    } else if (arg === '--front') {
      front = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'config.js';
    } else if (arg === '--db') {
      withDatabase = true;
    } else {
      deps.writeError(`Unknown option: ${arg.slice(0, 40)}\n${USAGE}`);
      return 2;
    }
  }

  let env = deps.env;
  if (envFile) {
    try {
      env = deps.parseEnvFile(deps.readFile(envFile));
    } catch {
      deps.writeError(`The file ${envFile.slice(0, 80)} could not be read.`);
      return 2;
    }
  }

  let frontSource: string | undefined;
  if (front !== undefined) {
    try {
      frontSource = deps.readFile(front);
    } catch {
      deps.writeError(`The file ${front.slice(0, 80)} could not be read.`);
      return 2;
    }
  }

  const results: CheckResult[] = checkDeployment({ env, approvedConsentVersions: deps.approvedConsentVersions, frontConfigSource: frontSource });

  if (withDatabase) {
    if (!deps.connect || !env.DATABASE_URL) {
      results.push({ id: 'db', level: 'fail', title: 'The database could not be read', detail: 'DATABASE_URL is not set, so there is nothing to connect to.' });
    } else {
      try {
        const connection = await deps.connect(env);
        try {
          results.push(...(await checkDatabaseState(connection.query, deps.migrationFiles())));
        } finally {
          await connection.close();
        }
      } catch {
        // The text of a connection error can hold the address of the database: it is not printed.
        results.push({ id: 'db', level: 'fail', title: 'The database could not be reached', detail: 'Check DATABASE_URL, the TLS settings and that this machine may connect to it.' });
      }
    }
  }

  deps.write('Bridge Path: check before deployment');
  deps.write('(no value of a secret is shown; this only reads settings' + (withDatabase ? ' and the database' : '') + ')');
  deps.write('');
  for (const level of ['fail', 'warn', 'ok'] as const) {
    for (const item of results.filter(entry => entry.level === level)) {
      deps.write(`${LABEL[level]}  ${item.title}`);
      if (item.detail) {
        deps.write(`      ${item.detail}`);
      }
    }
  }
  const total = summarize(results);
  deps.write('');
  deps.write(`Result: ${total.ok} ok, ${total.warn} warnings, ${total.fail} failures.`);
  deps.write(total.fail > 0 ? 'Not ready: fix the failures first.' : total.warn > 0 ? 'Ready to start; read the warnings.' : 'Ready.');
  return total.fail > 0 ? 1 : 0;
}
