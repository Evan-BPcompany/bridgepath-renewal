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

## Integration tests (run on a real PostgreSQL)

Nine suites in `src/__integration__/` run the real SQL against a real PostgreSQL. Result on **PostgreSQL 16.15 on this machine**: **9 of 9 suites and 228 of 228 tests passed** (`npm run test:integration`). Real AWS S3 and SendGrid have **not** been called or verified (SendGrid is stubbed in the suites).

The first run found real concurrency defects (parallel estimate creation, failed-login counting, a session surviving a password change), which were fixed in the application, and tests that depended on the server's message language, which now check the SQLSTATE (`23505`, `23503`, `23514`, `23502`) instead. After the fixes the complete run passed on PostgreSQL 16.15 (9 suites, 228 tests), including: parallel estimate creation with every request succeeding and numbers 1..N without a gap; the name `receipt_sequence_receipt_date_key` of the unique constraint that the receipt retry rule (`utils/transactionRetry.ts`) relies on; exactly counted parallel login failures (4 parallel failures count 4, 6 lock the account); and no open session after a login races a password change.

The migration 008 rollback test **logs an error about a NULL `customer_email` on purpose**: it inserts an estimate without e-mail, rolls back 012 to 009, and expects the 008 rollback to be refused with `23502` on `estimates.customer_email`. It then checks that nothing changed (migration still recorded, contact CHECK still present, column still nullable, `knex_migrations_lock.is_locked = 0`) and that the rollback works once the row is gone. That log line is not a failure.

The migration 012 rollback tests also **log an error on purpose**: `Refusing to roll back migration 012: N estimate(s) hold a customer type or a privacy consent record ...`. They insert an estimate with a customer type (and a consent), expect the rollback to be refused, check that nothing changed (migration still recorded, columns and CHECKs still there, data intact, `knex_migrations_lock.is_locked = 0`), and that the rollback works once those values are cleared on purpose. That log line is not a failure.

| Suite | What it checks on the real database |
|---|---|
| `harness` | The first smoke test: all migrations apply in an own schema and roll back. |
| `isolation` | Every pool connection uses the test schema, a changed `search_path` does not leak to the next user of a connection, nothing lands in `public`. |
| `migrations` | 001-012 apply in order, are idempotent, create exactly the 11 application tables and the 007/009 indexes; seed data; every constraint (contact policy, CHECKs, memo length, unique keys, foreign keys and cascades); step-by-step rollback; up-down-up gives the identical schema; the 008 rollback refuses while an estimate has no e-mail; the 012 columns and their two CHECKs (SQLSTATE and constraint name), and the 012 rollback that refuses while an estimate holds a customer type or a consent. |
| `receiptSequence` | Numbering 001, 002, ...; new day at Korean midnight; rollback gives the number back; overflow at 999; parallel generation without duplicates or gaps. |
| `adminAuth` | Login, session rows (hash only), lockout counters stored in the database, revoked/expired/inactive sessions, the forced-change flag, refresh (rotation, expired access token, parallel refresh), logout. |
| `estimates` | Creating an estimate in one transaction (estimate, hashed access token, e-mail events); the contact policy (e-mail only, phone only, both, neither); all-or-nothing rollback; reading with the one-time token (used, expired, wrong, parallel); parallel creation. |
| `emailOutbox` | Queueing and idempotency keys; `FOR UPDATE SKIP LOCKED` with parallel workers; a `sending` event is never claimed again; the 1/2/4-minute retry schedule and `failed`; stale recovery; the worker with a **stubbed** SendGrid. |
| `adminEstimates` | List filters, Korean-day date filter, search (including `%` and `_` as plain characters, phone digits), sorting, paging; detail; status changes with history, roles, `expected_status`, parallel changes (`FOR UPDATE`); memos; file metadata. |
| `passwordChange` | New hash, flag cleared, every session of that admin revoked and no one else's, shared lockout counter, policy and 72-byte limit, parallel changes. |

### Safety, in layers

1. **Settings.** Only `TEST_DATABASE_URL` is read: a `postgres://` URL on `127.0.0.1`/`localhost`/`::1`, database name contains `test`, not the same database as `DATABASE_URL`. A missing, remote or unsafe URL stops the run before any connection.
2. **Server check.** After connecting, each suite verifies `current_database()` contains `test`, the server address is loopback and the version is 14 or newer, and aborts otherwise.
3. **Own schema.** Each suite creates `it_<8 hex>`, migrates inside it and drops it afterwards. The pool receives `search_path` as a connection option **and** the harness sets it again on every checkout, so a connection whose `search_path` was changed is repaired before the next use. Timeouts (`statement_timeout` 30 s, `lock_timeout` 15 s) stop a stuck test.
4. **Nothing else changes.** Before the schema is created and after it is dropped, the suite compares the schemas, the tables in `public` and their row counts; any difference fails the suite.
5. **The application never gets `DATABASE_URL`.** Each suite replaces `getPool()` (`jest.mock('../config/database', ...)`) with the schema-bound pool; the harness refuses to run if that mock is missing, and a unit test checks every suite for it and that no integration file mentions `DATABASE_URL`.
6. **No outside services.** The network guard of `jest.setup.js` applies (only this machine is reachable), SendGrid is replaced by a stub, and no suite uploads files, so S3 is never used.

Default behaviour (checked by `integrationSuites.test.ts`, which starts the integration config in a child process with a scrubbed environment): without `TEST_DATABASE_URL` everything is **skipped** and the run succeeds; with `REQUIRE_INTEGRATION=true` it **fails**; a remote host, a non-test database name or a URL equal to `DATABASE_URL` fails without connecting. `npm test` never runs these suites.

### Leftover schemas

A run that is killed (Ctrl+C at the wrong moment, a crash) can leave an `it_xxxxxxxx` schema behind. Nothing deletes it automatically. List and, if you want, drop by name:

```bash
npm run build
npm run it:schemas                       # lists leftover it_* schemas
npm run it:schemas -- drop it_1a2b3c4d   # drops exactly the named schema(s)
```

It uses `TEST_DATABASE_URL` only, under the same checks, refuses names that are not `it_` + 8 hex digits, and has no "drop all". Do not run it while the tests are running.

### Running them (PostgreSQL 14+ on this machine)

```bash
# 1. In the terminal session only (not in a file, never in chat or git):
#    set TEST_DATABASE_URL=postgres://<test user>:<password>@127.0.0.1:5432/bridgepath_test
# 2. The smoke test alone first:
npx jest --config jest.integration.config.js --runInBand harness
# 3. Then everything:
REQUIRE_INTEGRATION=true npm run test:integration
```

PowerShell: `$env:TEST_DATABASE_URL = "..."; $env:REQUIRE_INTEGRATION = "true"; npm run test:integration`.

CI: the `integration` job runs only when started manually with `run_integration` ticked, against a throw-away PostgreSQL service container.

## Not verified

PostgreSQL is verified (see above: PostgreSQL 16.15, 9 suites, 228 tests). The following have **never** been run against the real thing and must not be described as verified:

| Area | Status |
|---|---|
| Real SendGrid delivery | Checked only against a local stub server. |
| Real AWS S3 upload/delete | Mocked. |
| Heroku PostgreSQL connection and TLS | Settings are unit tested; no connection was made. |
| Behaviour with more than one server instance (rate limit counters are per process) | Not tested. |

## Coverage

`npm run test:coverage` fails below the thresholds in `jest.config.js`. Entry points that only start a process (`index.ts`, `scripts/bootstrap-admin.ts`), migrations and the integration harness are excluded. Write the report to a folder you do not commit (`--coverageDirectory`).
