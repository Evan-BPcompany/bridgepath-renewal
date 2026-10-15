# Operations

Target platform: **Heroku** with **Heroku PostgreSQL**. Nothing here has been deployed or run against Heroku yet; treat the steps as a checklist to verify at the first deployment.

## Requirements

- Node.js 20 or higher (`engines` in package.json).
- PostgreSQL 14+.
- Build before start: `npm run build`, then `npm start` (runs `dist/index.js`).

## Production settings checklist

The server **refuses to start** (throws while loading the configuration) if:

- `NODE_ENV=production` and `COOKIE_SECURE` is not `true` (admin cookies would travel over plain HTTP);
- `NODE_ENV=production` and `DATABASE_SSL=false`;
- `NODE_ENV=production` and `DATABASE_URL` contains `sslmode`, `ssl`, `sslcert`, `sslkey`, `sslrootcert` or `uselibpqcompat` (they would silently override `DATABASE_SSL*`);
- `JWT_SECRET` is missing or shorter than 32 characters; `CORS_ORIGINS` contains `*`; `TRUST_PROXY` is not an integer 0-10; `FILE_DOWNLOAD_ENABLED=true` without a download provider.

It starts but **logs a warning** in production when `TRUST_PROXY=0` (behind Heroku every client would share the router IP, breaking rate limits and audit IPs; the public estimate limit of 10 per hour would then be shared by ALL customers) or when `DATABASE_SSL_REJECT_UNAUTHORIZED=false`.

Recommended Heroku config (values are examples; set secrets with `heroku config:set`, never in files):

```
NODE_ENV=production
COOKIE_SECURE=true
TRUST_PROXY=1
CORS_ORIGINS=https://<your frontend origin>
JWT_SECRET=<random, 32+ characters>
DATABASE_SSL_REJECT_UNAUTHORIZED=false     # see below
```

`DATABASE_URL` is provided by the Heroku PostgreSQL add-on. Do not append `?sslmode=...` to it.

## Before opening estimate intake (privacy consent)

`POST /api/estimates` stores a privacy consent with every request, and **production accepts no estimate until a consent version is approved**:

- While `APPROVED_CONSENT_VERSIONS` (`src/config/privacyConsent.ts`) is empty, every `POST /api/estimates` answers `503` with `code: "PRIVACY_CONSENT_NOT_CONFIGURED"` and the server logs a warning at start. Health check, admin API and customer lookup keep working.
- `dev-draft` is accepted only in development and test, never in production.
- To open intake: get the consent text reviewed and approved, save it as `docs/privacy-consent/<version>.md`, add the version to `APPROVED_CONSENT_VERSIONS`, deploy, and make the front end send that version. The wording has not been written yet.
- Also required: `TRUST_PROXY=1` (see above), migration 012 applied (`npm run db:migrate`), one server instance. The IP address and the User-Agent are not stored.

## Database TLS (Heroku PostgreSQL)

- `DATABASE_SSL` defaults to **on** in production and cannot be turned off there. The app pool (`src/config/database.ts`) and the knex `production` environment both use the same rule (`resolveDatabaseSsl` in `src/db/connectionSafety.ts`).
- `DATABASE_SSL_REJECT_UNAUTHORIZED` defaults to `true` (verify the certificate). Heroku PostgreSQL certificates are not signed by a public CA, so a Heroku deployment normally has to set it to `false`. The connection is then **encrypted but the server is not authenticated** (a man in the middle between the dyno and the database is not detected). This is a conscious, visible setting and produces a startup warning. If Heroku gives you a CA certificate for your plan, prefer verification (not implemented yet: it would need a `DATABASE_SSL_CA` option).
- No real connection was made to check any of this; it is covered by unit tests of the settings only.

## Database setup and migrations

```bash
export DATABASE_URL=<connection string>      # no default exists
npm run build
npm run db:migrate                            # knex, development environment
```

`scripts/setup-db.sh` refuses to run without `DATABASE_URL` and refuses to run if it equals `TEST_DATABASE_URL`. For production migrations run knex with the `production` environment (`npx knex migrate:latest --env production`) so TLS applies. Always take a backup first; rollback (`npm run db:rollback`) undoes the last batch only.

## First admin account

`npm run admin:bootstrap` (interactive, needs a terminal and `DATABASE_URL`) initializes the seeded master account with a one-time password; the account must change it at first login. The seed hash does **not** match any documented password, so the account is unusable until bootstrap is run. Details: README, "Admin account initialization".

## Email worker

`EMAIL_WORKER_ENABLED=true` starts the outbox loop in the web process. Run it on one dyno unless you accept that the claim query (`FOR UPDATE SKIP LOCKED`) is the only guard against two workers sending the same event (it is designed for that, but it is not verified against a real database). Events stuck in `sending` longer than `EMAIL_WORKER_STALE_TIMEOUT_MS` go back to `pending`. Without `SENDGRID_API_KEY` events stay pending and retry.

## Logs and monitoring

- Logs go to stdout (Heroku logplex, not durable). Output is allowlist-based: see [SECURITY.md](SECURITY.md#logging).
- `admin_audit {...}` lines record admin actions. Only status changes are also stored in the database (`status_history`).
- **Sentry is not integrated.** `SENTRY_DSN` is read but does nothing. There is no error alerting; add log drain alerts or integrate Sentry before launch.
- `GET /health` returns `{status, timestamp, environment}` without touching the database (it does not prove the database is up).

## Not available yet

an approved privacy consent text (production answers 503 to estimate requests until then), ClamAV scanning (files stay quarantined, downloads blocked), customer status emails, durable audit logs, a shared rate-limit store for multiple instances (the limits, including the public API limits, are per process: run one instance). See README, "Required before public launch".
