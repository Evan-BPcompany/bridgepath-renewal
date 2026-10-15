# Security

State after Phase 3 Week 3. "Verified" below means covered by automated tests with a fake database; nothing was run against real PostgreSQL, AWS or SendGrid.

## Authentication and sessions

- Admin login sets two **HttpOnly, SameSite=Strict** cookies: `access_token` (path `/admin`, JWT HS256, 8h) and `refresh_token` (path `/admin/token/refresh`, random 256-bit value). `Secure` follows `COOKIE_SECURE`, which must be `true` in production (startup check).
- Every admin request is checked against the database: session exists, not revoked, not expired, account active. Accounts flagged `must_change_password` are denied everywhere except password change and logout (deny by default).
- **Refresh** (`POST /admin/token/refresh`) depends only on the refresh token cookie: it is looked up by its SHA-256 hash; an expired, forged or missing access token is irrelevant. 401 for: no cookie, malformed token (rejected before any database access), unknown token, revoked session, expired session, inactive account. The role comes from the database, not from any cookie. The token is **rotated** with a single `UPDATE ... WHERE refresh_token_hash = <old hash> AND NOT revoked AND not expired`, so two parallel refreshes cannot both succeed. Only hashes are stored. The rotation runs in a short transaction that first locks the user row with `SELECT ... FOR SHARE` and checks again that the account is active (and reads the role) under that lock, so an account deactivation or a password change that is in flight is serialized with the refresh instead of being missed; parallel refreshes do not wait for each other. Lock order is always user row, then session row, the same as in the login and the password change, so they cannot deadlock. Not covered: deactivating an account does not revoke its sessions (there is no deactivation feature yet), the refresh ignores `locked_until` (the lockout applies to the login only) and there is no refresh token reuse detection.
- Not implemented: reuse detection (presenting an already-rotated token just fails; it does not revoke the session), an absolute session cap beyond the 30 days set at login.
- Password policy: at least 12 characters, at most 72 UTF-8 bytes (bcrypt limit). Login lockout: 5 failures lock the account for 15 minutes; an expired lock resets the counter.
- Rate limits (in memory, per process): login failures per IP, all `/admin` per IP, mutations and password changes per admin. With several instances the effective limit multiplies. `TRUST_PROXY` must equal the number of proxies (Heroku: 1).

## HTTP hardening

- `helmet` defaults on every response (including 401/404/429): `X-Content-Type-Options`, `X-Frame-Options`, HSTS, `Referrer-Policy`, CSP and others. `X-Powered-By` is removed.
- `Cache-Control: no-store` on all `/admin` and `/api` responses (they carry personal and business data).
- CORS: explicit origin list, credentials allowed, no wildcard (startup check).

## Database

- No default database or credentials anywhere (knexfile, `setup-db.sh`). Tests can only use `TEST_DATABASE_URL` (local, name contains `test`, differs from `DATABASE_URL`).
- TLS in production is mandatory; see [OPERATIONS.md](OPERATIONS.md#database-tls-heroku-postgresql). Accepted risk on Heroku: `DATABASE_SSL_REJECT_UNAUTHORIZED=false` encrypts but does not authenticate the server.
- All queries are parameterized. Two values are interpolated into SQL text (the email retry delay and the stale timeout); both are numbers computed in code, never request input.

## Logging

Everything passes through `src/utils/logSanitizer.ts` before it is written:

- Metadata is **allowlist-based**: identifiers, counts, statuses and short error texts only. Any other key is dropped.
- Keys that look sensitive are dropped even if allowlisted: `password`, `token`, `hash`, `secret`, `api key`, `email`, `phone`, `authorization`, `cookie`, `body`, `content`, `reason`, `s3_key`, `session`, `credential`.
- Objects and arrays are never written. Strings are masked (passwords in URLs, bearer tokens, JWTs, SendGrid and AWS keys, `key=value` secrets, e-mail addresses, long hex strings) and cut to 300 characters; messages to 1000; stacks to 2000.
- Audit entries (`admin_audit {...}`) hold only action, result, status code, admin/estimate/file/memo ids, statuses, error code and IP.
- Known gap: the allowlist protects the logger, not `console.log`; the only `console.log` calls print the port, environment and CORS origins at startup.

## Files and email

- Uploads are checked for MIME type and magic bytes. **ClamAV is not implemented**; files stay `quarantine`/`pending` and admin downloads are blocked (`FILE_DOWNLOAD_ENABLED=false`).
- Email uses an outbox with idempotency keys. A bug that could send the same event twice (the claim query also picked up events already being sent) was fixed in Week 3; this is verified only at the SQL-text level.
- An invalid `specification_json` string on the customer API answers 400 (`Invalid specification_json`), not 500; the message never echoes the input.

## Dependency audit

| Scope | Command | State |
|---|---|---|
| Production | `npm run audit:prod` | 0 vulnerabilities |
| Development | `npm run audit:dev` (fails on high/critical) | passes; **20 moderate accepted** |

Accepted: `sprintf-js` 1.0.3 (denial of service through unbounded precision specifiers, GHSA-hp3w-g68c-fv3c) and the chain `argparse` → `js-yaml` → `@istanbuljs/load-nyc-config` → `babel-plugin-istanbul` → jest/ts-jest tooling. Only reachable on machines that install dev dependencies; they never format untrusted input. The only npm fix is a breaking downgrade of `ts-jest`. Re-check when jest/ts-jest are updated; remove this entry as soon as `npm run audit:dev` can run with `--audit-level=moderate`.

## Secret scanning

`npm run secret-scan` (also a test and a CI step) fails on AWS keys, SendGrid keys, JWTs, private key blocks, `JWT_SECRET` values and real-looking database URLs with passwords. It prints file and line only. A deliberate fake can carry the marker `secret-scan:allow` on its line. It is a safety net, not a replacement for keeping `.env` out of git (it is in `.gitignore`).

## Open items before public launch

See README, "Required before public launch". Security-relevant: ClamAV and download provider, durable audit logs, public API rate limiting and a shared limiter store, refresh token reuse detection, Sentry/alerting, CA-verified database TLS, a real SendGrid test send (the integration tests have run on PostgreSQL 16.15; AWS and SendGrid are still unverified).
