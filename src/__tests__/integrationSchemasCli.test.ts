import { SchemaClient, parseArguments, runSchemasCli } from '../cli/integrationSchemasCli';

const URL = 'postgres://tester:Pw-for-test-only@127.0.0.1:5432/app_test';

function setup(options: { schemas?: string[]; env?: Record<string, string | undefined>; connectFails?: boolean } = {}) {
  const queries: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const client: SchemaClient = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: sql.startsWith('SELECT') ? (options.schemas ?? []).map(nspname => ({ nspname })) : [] };
    }),
    end: jest.fn(async () => undefined)
  };
  const createClient = jest.fn(async () => {
    if (options.connectFails) {
      throw new Error(`connect failed for ${URL}`);
    }
    return client;
  });
  const run = (argv: string[]) =>
    runSchemasCli(argv, {
      env: options.env ?? { TEST_DATABASE_URL: URL },
      createClient,
      write: line => out.push(line),
      writeError: line => err.push(line)
    });
  return { run, queries, out, err, client, createClient };
}

describe('parseArguments', () => {
  it('lists by default', () => {
    expect(parseArguments([])).toEqual({ command: 'list' });
    expect(parseArguments(['list'])).toEqual({ command: 'list' });
  });

  it('drops only schemas that are named, once each', () => {
    expect(parseArguments(['drop', 'it_1a2b3c4d', 'it_00000000', 'it_1a2b3c4d'])).toEqual({
      command: 'drop',
      names: ['it_1a2b3c4d', 'it_00000000']
    });
  });

  it.each([
    [['drop']],
    [['drop', 'public']],
    [['drop', 'it_1a2b3c4d; DROP SCHEMA public']],
    [['drop', 'it_1A2B3C4D']],
    [['drop', 'it_*']],
    [['drop', 'it_1a2b3c4']],
    [['drop', '--all']],
    [['list', 'extra']],
    [['wipe']]
  ])('refuses %j', argv => {
    expect(parseArguments(argv).command).toBe('error');
  });

  it('knows help', () => {
    expect(parseArguments(['--help']).command).toBe('help');
  });
});

describe('runSchemasCli', () => {
  it('does not connect with an unsafe or missing TEST_DATABASE_URL', async () => {
    for (const env of [
      {},
      { TEST_DATABASE_URL: 'postgres://u:p@db.example.invalid:5432/app_test' },
      { TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/production' },
      { TEST_DATABASE_URL: URL, DATABASE_URL: URL }
    ]) {
      const t = setup({ env });

      expect(await t.run(['list'])).toBe(1);
      expect(t.createClient).not.toHaveBeenCalled();
      expect(t.err.join('\n')).toContain('Nothing was changed');
    }
  });

  it('never uses DATABASE_URL', async () => {
    const t = setup({ env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/app_test' } });

    expect(await t.run(['list'])).toBe(1);
    expect(t.createClient).not.toHaveBeenCalled();
  });

  it('lists leftover schemas and changes nothing', async () => {
    const t = setup({ schemas: ['it_1a2b3c4d', 'it_deadbeef'] });

    expect(await t.run([])).toBe(0);
    expect(t.out.join('\n')).toContain('it_1a2b3c4d');
    expect(t.out.join('\n')).toContain('it_deadbeef');
    expect(t.queries.every(sql => sql.startsWith('SELECT'))).toBe(true);
    expect(t.client.end).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing is left over', async () => {
    const t = setup({ schemas: [] });

    expect(await t.run(['list'])).toBe(0);
    expect(t.out.join('\n')).toContain('No leftover');
  });

  it('drops exactly the named schemas and nothing else', async () => {
    const t = setup({ schemas: ['it_1a2b3c4d', 'it_deadbeef'] });

    expect(await t.run(['drop', 'it_1a2b3c4d'])).toBe(0);

    expect(t.queries.filter(sql => sql.startsWith('DROP'))).toEqual(['DROP SCHEMA "it_1a2b3c4d" CASCADE']);
  });

  it('refuses to drop a schema that is not a leftover test schema, before dropping anything', async () => {
    const t = setup({ schemas: ['it_1a2b3c4d'] });

    expect(await t.run(['drop', 'it_1a2b3c4d', 'it_deadbeef'])).toBe(1);

    expect(t.queries.some(sql => sql.startsWith('DROP'))).toBe(false);
    expect(t.err.join('\n')).toContain('it_deadbeef');
  });

  it('prints help without connecting', async () => {
    const t = setup();

    expect(await t.run(['help'])).toBe(0);
    expect(t.createClient).not.toHaveBeenCalled();
  });

  it('does not print connection details when the connection fails', async () => {
    const t = setup({ connectFails: true });

    expect(await t.run(['list'])).toBe(1);
    expect(t.err.join('\n')).not.toMatch(/Pw-for-test-only|127\.0\.0\.1|tester/);
  });

  it('does not print details when a query fails, and still closes the connection', async () => {
    const t = setup({ schemas: ['it_1a2b3c4d'] });
    (t.client.query as jest.Mock).mockRejectedValue(new Error(`boom ${URL}`));

    expect(await t.run(['list'])).toBe(1);
    expect(t.err.join('\n')).not.toContain('Pw-for-test-only');
    expect(t.client.end).toHaveBeenCalledTimes(1);
  });

  it('does not print the password of the URL in its normal output', async () => {
    const t = setup({ schemas: ['it_1a2b3c4d'] });

    await t.run(['list']);
    await t.run(['drop', 'it_1a2b3c4d']);

    expect([...t.out, ...t.err].join('\n')).not.toMatch(/Pw-for-test-only|tester/);
  });
});
