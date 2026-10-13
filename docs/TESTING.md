# Testing

## Commands

| Command | What it does | Needs |
|---|---|---|
| `npm test` | All unit tests (`src/__tests__`). Fake database, no network. | nothing |
| `npm run test:coverage` | Same, with coverage and thresholds (lines/statements/functions 95%, branches 87%). | nothing |
| `npm run test:integration` | Tests against a real PostgreSQL **on this machine**. Skipped unless configured. | local PostgreSQL 14+, `TEST_DATABASE_URL` |
| `npm run secret-scan` | Looks for committed credentials (also part of `npm test`). | nothing |
| `npm run audit:prod` / `npm run audit:dev` | Dependency audits, see [SECURITY.md](SECURITY.md). | npm registry access |

## How the unit tests stay safe

- **No real services.** `jest.setup.js` runs before every test file and refuses any connection that does not stay on this machine: http/https requests, raw TCP/TLS sockets (what database drivers use) and `fetch`. A blocked call fails with `External ... blocked in tests: <host>` before any lookup. `networkGuard.test.ts` verifies this using only unresolvable `.invalid` host names and refuses to run if the guard is missing. Do not weaken the guard to make a test pass.
- **Fake database.** Route and service tests replace `getPool()` with `createFakeDb()` (`src/__tests__/helpers/adminTestUtils.ts`): `pool.query`, `pool.connect` and the client are mocks, and a per-test handler answers the SQL a test cares about.
- **Fake credentials only.** Any value in a test is made up (`.invalid` hosts, `127.0.0.1`, fake keys). Fake keys must never be sent anywhere: the SendGrid compatibility test talks to a stub server on `127.0.0.1` only.
- **Child processes** (`setupDbScript`, `bootstrapLauncher`, ...) start with `cleanChildEnv()` (`helpers/cleanEnv.ts`), which removes `DATABASE_URL`, `TEST_DATABASE_URL`, `PG*`, `AWS_*`, `S3_BUCKET`, `SENDGRID_*`, `JWT_SECRET`, `SENTRY_DSN` before adding the few fake values a test needs.
- **Tests must prove something.** Behaviour is asserted (status codes, headers, the SQL that is sent, state after the call). Pure "documentation" tests were removed. When a test guards a safety property, check it by breaking the code on purpose (mutation check): the test has to fail.

## Integration tests (prepared, never run)

The harness exists (`jest.integration.config.js`, `src/__integration__/`) but **has not been run**, because no PostgreSQL is available. It is built so that running it cannot damage anything:

- Needs `TEST_DATABASE_URL`. It must be a `postgres://` URL on `127.0.0.1`/`localhost`/`::1`, the database name must contain `test`, and it must not be the same database as `DATABASE_URL`. A remote host, a missing variable or an equal URL stops the run before connecting.
- Each run creates its own schema `it_<8 hex>`, runs the migrations inside it and drops it afterwards. Nothing outside that schema is touched.
- By default the integration tests are **skipped**. With `REQUIRE_INTEGRATION=true` a missing or invalid setup **fails** the run (this is what CI uses when started by hand).
- The same network guard applies, so AWS and SendGrid stay blocked even here.
- CI: the `integration` job runs only when started manually with `run_integration` ticked, against a throw-away PostgreSQL service container.

To run them locally once PostgreSQL 14+ is installed (after separate approval):

```bash
createdb bridgepath_test
TEST_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/bridgepath_test REQUIRE_INTEGRATION=true npm run test:integration
```

## Not verified

These have **never** been run against the real thing and must not be described as verified:

| Area | Status |
|---|---|
| SQL against a real PostgreSQL (row locking, filters, search, memo/password queries, `FOR UPDATE SKIP LOCKED`, SERIALIZABLE receipt ids) | Only the SQL text and the surrounding logic are tested with a fake pool. |
| Migrations 001-011 | Compile and structure are tested; not applied to a real database in this phase. |
| Real SendGrid delivery | Checked only against a local stub server. |
| Real AWS S3 upload/delete | Mocked. |
| Heroku PostgreSQL connection and TLS | Settings are unit tested; no connection was made. |
| Behaviour with more than one server instance (rate limit counters are per process) | Not tested. |

## Coverage

`npm run test:coverage` fails below the thresholds in `jest.config.js`. Entry points that only start a process (`index.ts`, `scripts/bootstrap-admin.ts`), migrations and the integration harness are excluded. Write the report to a folder you do not commit (`--coverageDirectory`).
