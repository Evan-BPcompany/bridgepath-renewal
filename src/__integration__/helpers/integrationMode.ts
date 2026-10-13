import { checkTestDatabaseUrl } from '../../db/connectionSafety';

type Env = Record<string, string | undefined>;

export type IntegrationMode =
  // TEST_DATABASE_URL passed every safety check: the suites run.
  | { kind: 'enabled'; url: string; description: string }
  // Nothing configured and not required: the suites are reported as skipped.
  | { kind: 'skipped'; reason: string }
  // REQUIRE_INTEGRATION=true but no database configured: the run fails.
  | { kind: 'required-missing'; reason: string }
  // A URL is configured but unsafe (same as DATABASE_URL, remote, not a test database): always fails.
  | { kind: 'invalid'; reason: string };

export function resolveIntegrationMode(env: Env = process.env): IntegrationMode {
  const check = checkTestDatabaseUrl(env);

  if (check.ok) {
    return { kind: 'enabled', url: check.url, description: check.description };
  }

  if (check.code === 'NOT_SET') {
    if (env.REQUIRE_INTEGRATION === 'true') {
      return {
        kind: 'required-missing',
        reason: 'REQUIRE_INTEGRATION=true but TEST_DATABASE_URL is not set, so the integration tests cannot run.'
      };
    }
    return {
      kind: 'skipped',
      reason: 'TEST_DATABASE_URL is not set: integration tests are skipped.'
    };
  }

  return { kind: 'invalid', reason: check.message };
}

export interface IntegrationContext {
  // The test database URL; an empty string when the suites are skipped.
  url: string;
}

// Use instead of describe() for suites that need PostgreSQL. Definitions must not touch the
// database directly; connect inside beforeAll/it.
export function describeIntegration(name: string, define: (context: IntegrationContext) => void): void {
  const mode = resolveIntegrationMode();

  if (mode.kind === 'enabled') {
    describe(name, () => define({ url: mode.url }));
    return;
  }

  if (mode.kind === 'skipped') {
    describe.skip(name, () => define({ url: '' }));
    return;
  }

  describe(name, () => {
    it('cannot run: the integration test setup is not valid', () => {
      throw new Error(mode.reason);
    });
  });
}
