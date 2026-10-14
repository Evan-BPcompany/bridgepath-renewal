import { SCHEMA_NAME_PATTERN, checkTestDatabaseUrl } from '../db/connectionSafety';

// Manual clean-up for isolated test schemas (it_<8 hex>) that an interrupted integration run
// left behind. Nothing is ever deleted automatically: this command lists them, and drops
// only the schemas whose names are given explicitly. It uses TEST_DATABASE_URL only, under
// the same safety checks as the tests (local host, database name contains "test", not DATABASE_URL).

export interface SchemaClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export interface SchemasCliDeps {
  env: Record<string, string | undefined>;
  createClient: (connectionString: string) => Promise<SchemaClient>;
  write: (line: string) => void;
  writeError: (line: string) => void;
}

export type ParsedArguments =
  | { command: 'list' }
  | { command: 'drop'; names: string[] }
  | { command: 'help' }
  | { command: 'error'; message: string };

export function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'list') {
    return rest.length === 0 ? { command: 'list' } : { command: 'error', message: '"list" takes no arguments.' };
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }

  if (command === 'drop') {
    if (rest.length === 0) {
      return { command: 'error', message: 'Name the schemas to drop, for example: drop it_1a2b3c4d. There is no "drop all".' };
    }
    const bad = rest.filter(name => !SCHEMA_NAME_PATTERN.test(name));
    if (bad.length > 0) {
      return { command: 'error', message: 'Only schemas named it_ followed by 8 hex digits can be dropped.' };
    }
    return { command: 'drop', names: [...new Set(rest)] };
  }

  return { command: 'error', message: `Unknown command "${command}". Use "list" or "drop <schema>...".` };
}

const USAGE = [
  'Usage:',
  '  npm run it:schemas                      list leftover it_* schemas',
  '  npm run it:schemas -- drop it_1a2b3c4d  drop the named schema(s) (never more than named)',
  'Uses TEST_DATABASE_URL only. Do not drop a schema while integration tests are running.'
];

export async function runSchemasCli(argv: string[], deps: SchemasCliDeps): Promise<number> {
  const parsed = parseArguments(argv);

  if (parsed.command === 'help') {
    USAGE.forEach(deps.write);
    return 0;
  }
  if (parsed.command === 'error') {
    deps.writeError(parsed.message);
    USAGE.forEach(deps.writeError);
    return 1;
  }

  const check = checkTestDatabaseUrl(deps.env);
  if (!check.ok) {
    deps.writeError(`${check.message} Nothing was changed.`);
    return 1;
  }

  let client: SchemaClient;
  try {
    client = await deps.createClient(check.url);
  } catch {
    // The error text of a failed connection can contain connection details.
    deps.writeError('Could not connect to the test database. Nothing was changed.');
    return 1;
  }

  try {
    const result = await client.query(
      `SELECT nspname FROM pg_namespace WHERE nspname ~ '^it_[0-9a-f]{8}$' ORDER BY nspname`
    );
    const existing = result.rows.map(row => String(row.nspname));

    if (parsed.command === 'list') {
      if (existing.length === 0) {
        deps.write(`No leftover it_* schemas in ${check.description}.`);
      } else {
        deps.write(`Leftover it_* schemas in ${check.description}:`);
        existing.forEach(name => deps.write(`  ${name}`));
        deps.write('Drop one with: npm run it:schemas -- drop <name>');
      }
      return 0;
    }

    const missing = parsed.names.filter(name => !existing.includes(name));
    if (missing.length > 0) {
      deps.writeError(`Not found in ${check.description}: ${missing.join(', ')}. Nothing was changed.`);
      return 1;
    }

    for (const name of parsed.names) {
      // The name was matched against SCHEMA_NAME_PATTERN above, so it is safe to quote.
      await client.query(`DROP SCHEMA "${name}" CASCADE`);
      deps.write(`Dropped schema ${name} in ${check.description}.`);
    }
    return 0;
  } catch {
    deps.writeError('The command failed. Some schemas may not have been dropped; run "list" to check.');
    return 1;
  } finally {
    await client.end();
  }
}
