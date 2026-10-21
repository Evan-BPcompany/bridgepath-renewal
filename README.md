# Bridge Path MVP

> Manufacturer OEM/ODM Quote Platform

## 🎯 Project Overview

Bridge Path is a platform that streamlines the quote request process for manufacturers and their customers. The MVP supports multiple product categories (eyewear, shoes, golf products, and other) with structured estimation workflows.

**Status**: Phase 3 Admin API Weeks 1-3 implemented (Week 3 = test hardening, security review and documentation), awaiting review. Phase 1 and Phase 2 Days 1-3 are complete; Phase 2 Days 4-7 are pending. The SQL has been run against a real local PostgreSQL 16.15 (9 integration suites, 253 tests passed); AWS and SendGrid are still unverified (see "Not verified" in [docs/TESTING.md](docs/TESTING.md)).

## 🔧 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | HTML5 / CSS3 / JavaScript | - |
| **Backend** | Node.js + Express + TypeScript | 20+ / 4.18.x / 5.0.x |
| **Database** | PostgreSQL | 14+ |
| **File Storage** | AWS S3 | - |
| **Email** | Sendgrid API | - |
| **Logging** | Winston (Sentry is **not integrated**: `SENTRY_DSN` is read but unused) | 3.8.x |

## 📂 Project Structure

```
bridge-path-mvp/
├── src/
│   ├── config/
│   │   ├── env.ts           # Environment variables loader
│   │   └── database.ts      # PostgreSQL pool configuration
│   ├── db/
│   │   └── migrations/      # Knex.js TypeScript migrations
│   │       ├── 001_init_schema.ts
│   │       ├── 002_admin_sessions.ts
│   │       ├── 003_estimate_access_tokens.ts
│   │       ├── 004_base_prices_and_email.ts
│   │       ├── 005_seed_dev_data.ts
│   │       ├── 006_receipt_sequence.ts
│   │       ├── 007_email_events_schema_enhancement.ts
│   │       ├── 008_customer_contact_policy.ts
│   │       ├── 009_admin_api_indexes.ts
│   │       ├── 010_admin_memos_content_check.ts
│   │       ├── 011_admin_must_change_password.ts
│   │       ├── 012_customer_type_and_privacy_consent.ts
│   │       └── 013_align_estimate_statuses.ts
│   ├── utils/
│   │   └── logger.ts        # Winston logger setup
│   ├── types/
│   │   └── models.ts        # TypeScript interfaces
│   └── index.ts             # Express server entry point
├── tsconfig.json            # TypeScript configuration
├── package.json             # Dependencies and scripts
├── .env.example             # Environment variables template
├── .gitignore               # Git ignore rules
└── README.md                # This file
```

## 🚀 Getting Started

### Prerequisites
- Node.js 20 or higher (`engines` in package.json)
- npm or yarn
- PostgreSQL 14+ (for database operations)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/bridge-path.git
cd bridge-path-mvp
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from template:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
NODE_ENV=development
PORT=4000
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
DATABASE_URL=postgresql://user:password@localhost:5432/bridgepath_dev
```

### Running the Server

**Development**:
```bash
npm run dev
```

**Production**:
```bash
npm run build
npm start
```

### Database Setup (Phase 1 Day 2+)

**Prerequisites**:
- PostgreSQL 14+ installed and running (UUID support required)
- `DATABASE_URL` environment variable configured

**Knex.js TypeScript Migrations**:
All migrations are written in TypeScript with `up()` and `down()` functions for forward/rollback operations:

```
src/db/migrations/
├── 001_init_schema.ts              (Core 6 tables)
│   ├── admin_users
│   ├── estimates
│   ├── files
│   ├── quotations
│   ├── status_history
│   └── admin_memos
├── 002_admin_sessions.ts           (1 table: admin_sessions)
├── 003_estimate_access_tokens.ts   (1 table: estimate_access_tokens)
├── 004_base_prices_and_email.ts    (2 tables)
│   ├── base_prices
│   └── email_events
├── 005_seed_dev_data.ts            (Development/test data only)
├── 006_receipt_sequence.ts         (1 table: receipt_sequence - infrastructure)
├── 007_email_events_schema_enhancement.ts  (email_events columns/indexes added, no new table)
├── 008_customer_contact_policy.ts  (estimates.customer_email nullable + email-or-phone CHECK, no new table)
├── 009_admin_api_indexes.ts        (3 admin query indexes, no new table)
├── 010_admin_memos_content_check.ts  (admin_memos.content length CHECK, no new table)
├── 011_admin_must_change_password.ts  (admin_users.must_change_password flag, no new table)
├── 012_customer_type_and_privacy_consent.ts  (estimates.customer_type, privacy_consent_at, privacy_consent_version + 2 CHECKs, no new table)
└── 013_align_estimate_statuses.ts  (estimates.status = the 10 statuses of the PRD; backup table estimate_status_backup)
```

**Migration files: 13 (001-013)** - 008 to 012 were added after the first schema and create no tables; 013 creates the helper table `estimate_status_backup` (see "Statuses of the PRD and migration 013")

**Application Tables: 10**
- Core tables: 6 (001)
- Session management: 1 (002)
- Access tokens: 1 (003)
- Pricing & communication: 2 (004)
- Migration 007 only extends `email_events` (adds next_retry_at, last_error, provider_message_id, updated_at); it creates no table

**Infrastructure Tables: 1**
- receipt_sequence: 1 (006)

**Knex Management Tables: 1 (auto-created)**
- knex_migrations: tracks migration state (Knex also creates a `knex_migrations_lock` helper table)

**Migration helper table: 1**
- estimate_status_backup: 1 (013) - the original status of the estimates that migration 013 changed; dropped when 013 is rolled back

**Total: 10 application + 1 infrastructure + 1 migration helper table = 12 tables (+ Knex-managed tables)**

**Run migrations** (requires DATABASE_URL):
```bash
# Step 1: Build TypeScript (validates migration structure)
npm run build
# ✓ Verifies all migration files compile correctly
# ✓ Creates executable JavaScript migrations in dist/db/migrations/

# Step 2: Run actual database migrations
# (Only possible after DATABASE_URL is configured)
npm run db:migrate
# This will:
# - Execute all pending migrations sequentially
# - Track migration state in knex_migrations table
# - Apply all schema and seed data
```

**Rollback migrations** (reverts last migration):
```bash
npm run db:rollback
```

**Manual setup script** (alternative with validation):
```bash
bash scripts/setup-db.sh
# This script:
# - Checks PostgreSQL client is installed
# - Runs migrations
# - Verifies table creation
# - Confirms admin user and sample data
```

**Current Status**:
- ✅ TypeScript migrations created and compiled
- ✅ Migration structure verified (11 migration files: 10 application tables + receipt_sequence)
- ⏳ Actual database migration: **NOT YET TESTED**. It can only be run after `DATABASE_URL` is configured.

**Verify database** (only after migrations are executed with DATABASE_URL):
```bash
# Connect to the database
psql $DATABASE_URL

# List all tables (10 application + receipt_sequence + Knex-managed tables)
\dt

# Verify master admin user was created
SELECT username, email, role FROM admin_users WHERE username = 'master';

# Verify receipt_sequence exists (006)
SELECT to_regclass('public.receipt_sequence');

# Verify email_events columns added by 007
SELECT column_name FROM information_schema.columns
WHERE table_name = 'email_events'
  AND column_name IN ('next_retry_at', 'last_error', 'provider_message_id', 'updated_at');
# Expected: 4 rows

# Verify application + infrastructure tables (excluding Knex-managed tables)
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'knex_%';
# Expected: 11

# Verify sample base prices (marked with [SAMPLE])
SELECT category, product_variant, description FROM base_prices
WHERE description LIKE '[SAMPLE]%' LIMIT 5;

# Verify migration history
SELECT migration FROM knex_migrations ORDER BY batch DESC LIMIT 5;
```

**Default admin credentials** (created by migration in DEV ENVIRONMENT ONLY):
- Username: `master`
- Email: `admin@bridgepath.local`
- Password: `CHANGE_ME_ON_FIRST_LOGIN` (bcryptjs hash)
- ⚠️ **MUST be changed on first login**
- ⚠️ **This is for development/testing only. Production deployments must use a separate admin initialization process.**

**Sample base prices**:
- Sample pricing for eyewear, shoes, golf products, and other categories are created by the seed migration
- These are **marked with [SAMPLE]** label in descriptions
- Use only for development and testing
- In production, configure actual pricing through admin APIs

## 📋 Environment Variables

Copy `.env.example` to `.env` (never commit it). `JWT_SECRET` is the only variable the server cannot start without; the rest depend on the feature.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production` or `test`. In `production` the safety checks below are enforced. |
| `PORT` | no | `4000` | Server port (1-65535). |
| `CORS_ORIGINS` | no | `http://localhost:3000` | Comma-separated allowed origins. Wildcards are rejected. |
| `JWT_SECRET` | **yes** | - | Access token signing secret, at least 32 characters. |
| `JWT_EXPIRATION` | no | `8h` | Access token lifetime. |
| `REFRESH_TOKEN_EXPIRATION` | no | `30d` | Reserved; the session lifetime is fixed at 30 days when it is created. |
| `COOKIE_SECURE` | **yes in production** | `false` | Must be `true` when `NODE_ENV=production`, otherwise the server refuses to start. Keep `false` for plain-HTTP local development. |
| `DATABASE_URL` | for DB features | - | PostgreSQL connection string. There is **no default**; knex and `scripts/setup-db.sh` stop when it is missing. |
| `DATABASE_SSL` | no | `true` in production, else `false` | TLS for the application database. `false` is refused in production. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | no | `true` | Verify the server certificate. Heroku PostgreSQL needs `false` (see [docs/OPERATIONS.md](docs/OPERATIONS.md)); the server logs a warning when it is `false` in production. |
| `TEST_DATABASE_URL` | integration tests only | - | The only database tests may use: local host, name contains `test`, different from `DATABASE_URL`. |
| `REQUIRE_INTEGRATION` | no | unset | `true` makes the integration tests fail instead of being skipped when their setup is missing. |
| `TRUST_PROXY` | no | `0` | Number of reverse proxies in front of the app (integer 0-10; Heroku: `1`). Never `true`. A warning is logged in production when it is `0`. |
| `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 900000 / 10 | Failed logins per IP. |
| `ADMIN_API_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 60000 / 120 | All `/admin` requests per IP. |
| `ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 60000 / 30 | Status changes and memo creation per admin. |
| `ADMIN_PASSWORD_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 900000 / 5 | Password change attempts per admin. |
| `CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 3600000 / 10 | `POST /api/estimates` per client IP (public). |
| `CUSTOMER_ESTIMATE_READ_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 900000 / 30 | `GET /api/estimates/:receipt_id` per client IP (public). |
| `CUSTOMER_ESTIMATE_PREVIEW_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 900000 / 60 | `POST /api/estimate-preview` per client IP (public). |
| `CUSTOMER_IMAGE_ANALYSIS_RATE_LIMIT_WINDOW_MS` / `_MAX` | no | 3600000 / 10 | `POST /api/estimate-preview/analyze-image` per client IP (public; every request can cost a Claude API call). |
| `ANTHROPIC_API_KEY` | for photo analysis | - | Claude API key. Without it the analysis endpoint answers `503 IMAGE_ANALYSIS_NOT_CONFIGURED` and the form works without it. Never commit it. |
| `IMAGE_ANALYSIS_MODEL` | no | `claude-opus-5-5` | Model that reads the photo. |
| `FILE_DOWNLOAD_ENABLED` | no | `false` | `true` without a download provider stops the server at startup. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | for file upload | - | S3 storage for estimate files. |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | for email | - | Without a key the worker keeps events pending and retries. |
| `FRONTEND_BASE_URL` | no | first `CORS_ORIGINS` entry | Where the customer pages are served; the browser is sent back here after a Google/Kakao sign-in. Origin only (no path). |
| `PUBLIC_API_URL` | no | `http://localhost:<PORT>` | Public address of this API; the redirect address registered with Google/Kakao is `<PUBLIC_API_URL>/api/customers/oauth/<provider>/callback`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | - | The button shows only when the id is set (the secret is then required). |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | for Kakao sign-in | - | REST API key (client id); the secret only if it is switched on in the Kakao console. |
| `CUSTOMER_LOGIN_RATE_LIMIT_*`, `CUSTOMER_SIGNUP_RATE_LIMIT_*`, `CUSTOMER_CODE_RATE_LIMIT_*` | no | 10 failed logins / 15 min, 10 sign-ups / hour, 20 code requests / 15 min | Per IP; `_WINDOW_MS` and `_MAX`. |
| `ADMIN_NOTIFICATION_EMAIL` | no | - | Receives the new-estimate notification. |
| `EMAIL_WORKER_ENABLED` | no | `false` | Starts the email worker loop (never in `test`). |
| `EMAIL_WORKER_INTERVAL_MS`, `EMAIL_WORKER_STALE_TIMEOUT_MS` | no | 30000 / 300000 | Worker poll interval and stuck-`sending` recovery time. |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE` | no | - | Contact details shown in customer emails. |
| `LOG_LEVEL` | no | `info` | Winston level. |
| `SENTRY_DSN` | no | - | **Not used**: Sentry is not integrated. |

Security-relevant details are in [docs/SECURITY.md](docs/SECURITY.md); running and deploying is in [docs/OPERATIONS.md](docs/OPERATIONS.md); tests are in [docs/TESTING.md](docs/TESTING.md).

### Integration tests (real PostgreSQL)

`npm test` uses a fake database and never connects to anything. Nine integration suites in `src/__integration__/` run the real SQL against a **PostgreSQL 14+ on this machine**. Run against a real **PostgreSQL 16.15 on this machine**: **9 of 9 suites and 253 of 253 tests passed** (`npm run test:integration`). Real AWS S3 and SendGrid have **not** been called or verified (SendGrid is stubbed in the suites). Details, safety rules and what each suite checks: [docs/TESTING.md](docs/TESTING.md).

- They use `TEST_DATABASE_URL` only (local host, database name contains `test`, never the same as `DATABASE_URL`) and work in a throw-away schema `it_<8 hex>` that is dropped afterwards; nothing else in the database is touched.
- Without `TEST_DATABASE_URL`, `npm run test:integration` **skips** everything. With `REQUIRE_INTEGRATION=true` and no database it **fails**.
- With PostgreSQL 14+ and an empty database such as `bridgepath_test`, set the URL in the terminal session only (never in a file or in git) and run the smoke test first:

  ```powershell
  $env:TEST_DATABASE_URL = "postgres://<test user>:<password>@127.0.0.1:5432/bridgepath_test"
  npx jest --config jest.integration.config.js --runInBand harness
  $env:REQUIRE_INTEGRATION = "true"; npm run test:integration   # everything
  ```

- A killed run can leave an `it_xxxxxxxx` schema behind; nothing deletes it automatically. List it with `npm run build` then `npm run it:schemas`, and drop exactly the schema you name with `npm run it:schemas -- drop it_xxxxxxxx`.

## 🏗️ Development Phases

### Phase 1: Backend Foundation (5 days) - complete
- [x] Day 1: Project structure initialization (Express, TypeScript, config)
- [x] Day 2: PostgreSQL migrations and schema (10 application + 1 infrastructure tables, migration files 001-007 at that time)
- [x] Day 3: JWT authentication and session management
- [x] Day 4: Receipt ID generation and session refresh tokens
- [x] Day 5: Specification validation and error handling

### Phase 2: Customer API (7 days) - Days 1-4 complete
- [x] Day 1: Estimate submission endpoint (POST /api/estimates, GET /api/estimates/:receipt_id)
- [x] Day 2: File upload, validation, and S3 integration (multipart/form-data, magic bytes, compensation)
- [x] Day 3: Email notifications (SendGrid integration)
- [x] Day 4: Stabilization and documentation
- [ ] Days 5-7: Additional features and testing

### Phase 3: Admin API - Weeks 1-3 implemented, awaiting review
- [x] Week 1: estimate list/detail, auth and roles, status change
- [x] Week 2: memos, file metadata (downloads blocked), password change, login lockout, rate limiting
- [x] Week 3: test hardening, security review, documentation, CI
- [ ] Not done: quotation file attachment, customer status emails, ClamAV, real PostgreSQL/AWS/SendGrid verification (see "Required before public launch")

### Phase 4: Frontend Integration (7 days) - not started
- [ ] Connect existing HTML forms to API
- [ ] Fix known issues (script.js console errors)
- [ ] UI/UX improvements

### Phase 5: Testing & Deployment (7 days) - not started
- [ ] Unit and integration tests
- [ ] Heroku deployment
- [ ] Production setup

## 🔒 Security Features

- **Authentication**: JWT tokens with HttpOnly cookies
- **Session Management**: Revocable admin sessions
- **Access Control**: Token-based estimate access
- **File Validation**: MIME type and magic bytes. **ClamAV scanning is not implemented**; uploaded files stay quarantined and admin downloads are blocked
- **Email Safety**: Idempotency keys and retry logic
- **Hardening (Phase 3 Week 3)**: helmet security headers, `Cache-Control: no-store` on `/admin` and `/api`, production refuses to start without `COOKIE_SECURE=true` or with a plaintext database connection, refresh token rotation that does not depend on the access token, allowlist-based log output. See [docs/SECURITY.md](docs/SECURITY.md)

## 📞 Support

For questions or issues, please contact: contact@bridgepath.co.kr

---

## Phase 2 Day 1: Customer API (POST/GET estimates)

**Customer Quote Submission API**

Implemented secure customer quote submission and retrieval with:
- POST /api/estimates: Quote acceptance with validation and token generation
- GET /api/estimates/:receipt_id: Token-based retrieval with one-time use enforcement
- Atomic transaction: receipt_id generation, estimate saving, token creation in a single READ COMMITTED transaction
- Security: SHA-256 token hashing, one-time use, 7-day expiration

**API Contracts:**

```
POST /api/estimates
Request: { category, specification_json, customer_type, customer_name, company_name?, customer_email?, customer_phone?, privacy_consent, privacy_consent_version }
         (at least one of customer_email / customer_phone; company_name required for business_brand; see "Customer type and privacy consent")
Response: { success, receipt_id, access_token, created_at, message }   (no internal status; files, when sent, are listed under "files")

GET /api/estimates/:receipt_id?token=xxx
Response: { receipt_id, category, specification_json, created_at, updated_at, message }   (no internal status)
Error: { error: "Unauthorized", timestamp }
```

**Transaction Safety:**
- Single READ COMMITTED transaction for receipt ID generation + estimate/token storage
- generateReceiptIdInTransaction() uses existing client (no nested transactions)
- Atomic token marking: UPDATE with WHERE conditions, no SELECT then UPDATE race condition

**Token Security:**
- Generation: 32-byte random token (client only), SHA-256 hash (DB only)
- One-time use: Atomic UPDATE with is_used=false AND expires_at>NOW() condition
- Expiration: 7 days (checked in UPDATE query, not SELECT then check)
- No token or email in logs

**Customer Response Privacy:**
- Returns: receipt_id, category, specification_json, timestamps, and the fixed `message` (see "What customers see after an estimate request")
- Excludes: the internal status, customer_name, customer_email, customer_phone, company_name, customer_type and everything about the privacy consent
- Rationale: Customer already knows their own information

---

## Phase 1 Day 5: Specification Validation

**Category Mapping**

Frontend submits detail categories; backend normalizes to canonical categories:

```
Frontend (Detail) → Canonical
===========================
optical           → eyewear
sunglasses        → eyewear
sports            → eyewear
kids              → eyewear
safety            → eyewear
---
sneakers          → shoes
heels             → shoes
mens              → shoes
boots             → shoes
sandals           → shoes
---
bags              → golf_products
gloves            → golf_products
headwear          → golf_products
accessories       → golf_products
covers            → golf_products
training          → golf_products
---
other             → other
```

**Ajv-based Input Validation**

Implemented category-specific JSON schema validation for four canonical product categories:

```
src/utils/specification.ts
├── EyewearSpecification: frame_type, material, lens_type, quantity (required)
├── ShoesSpecification: shoe_type, material, size_range, quantity (required), special_requirements (optional)
├── GolfSpecification: product_type, material, quantity (required), customization (optional)
└── OtherSpecification: product_description, quantity (required), special_requirements (optional)
```

**Validation Middleware**

Created `src/middleware/validation.ts` with `validateEstimateSpecification` middleware that:
- Checks for required `category` and `specification_json` fields
- Validates category is one of: eyewear, shoes, golf_products, other
- Ensures `specification_json` is a valid object
- Runs Ajv schema validation against category-specific schemas
- Returns consistent 400 error responses with detailed field-level errors
- Logs validation failures without exposing sensitive data
- Attaches validated data to request for downstream handlers

**Error Response Format**

```json
{
  "error": "Invalid specification_json",
  "details": [
    "root/frame_type: must have minimum length 1",
    "root/quantity: must be >= 1"
  ],
  "timestamp": "2026-09-30T12:34:56.789Z"
}
```

**Validation Constraints**

- All string fields: minimum length 1 (no empty strings)
- All quantity fields: minimum 1, maximum 1,000,000
- Category field: const value matching the category parameter
- Additional properties: allowed (forward compatibility)
- Optional fields: can be undefined or null

**Testing**

Added comprehensive Jest test suite (`src/__tests__/specification.test.ts`) with 22 tests covering:
- Valid specifications per category
- Missing required fields
- Empty string validation
- Quantity boundary constraints (1, 1000000)
- Wrong type validation (number vs string)
- Unknown category rejection
- Null/non-object specification rejection
- Optional field validation

Run tests:
```bash
npm test
npm test:watch
```

All tests passing: ✅ 26/26 (specification validation tests)

---

## Phase 2 Day 1: Customer Quote Submission API

**Overview**

Implemented secure customer quote submission and retrieval with one-time access tokens:
- POST /api/estimates: Accept customer quote with category and specifications
- GET /api/estimates/:receipt_id: Retrieve quote details with token-based access
- Atomic transaction: Receipt ID generation + estimate storage + token creation in a single READ COMMITTED transaction

**Key Features:**
- **Receipt ID Generation**: Concurrent-safe with one atomic upsert (`INSERT ... ON CONFLICT (receipt_date) DO UPDATE ... RETURNING`): parallel requests queue on the row lock instead of failing, and a rolled-back transaction gives its number back (no gaps). More than 999 in a day rolls the whole transaction back. As a safeguard the whole estimate transaction is run again on SQLSTATE `40001` (and `23505` only on the `receipt_sequence_receipt_date_key` constraint; every other unique violation fails at once): one try plus 3 retries, 4 attempts in total, with 10/20/40 ms back-off. An error from `COMMIT` itself is never retried (its outcome is unknown), and the exhausted error carries the SQLSTATE and the attempt count.
- **Receipt ID format and date basis**: `BP` + `YYYYMMDD` + a 3-digit sequence that restarts every day (for example `BP20261013001`). The date is the calendar date in **Korea (`Asia/Seoul`, UTC+9)**, not the server's local time and not UTC: a server running in UTC (Heroku) therefore switches to the next day at 15:00 UTC, which is 00:00 in Korea. Receipts created from 00:00 to 08:59 Korean time do not get the previous day's date. `validateReceiptId` uses the Korean year for its upper limit as well. Receipt ids issued before this change used the server's local date; no existing ids are rewritten.
- **Access Token Security**: SHA-256 hashing, one-time use, 7-day expiration
- **Customer Privacy**: Returns only receipt_id, category, specification_json, timestamps and a fixed message (excludes customer PII and the internal status)
- **Transaction Safety**: the receipt number comes from an atomic row-locked upsert (READ COMMITTED), so there are no serialization failures to begin with; the estimate, token and e-mail outbox rows commit together

**API Contracts:**

```
POST /api/estimates
Request:  { category, specification_json, customer_type, customer_name, company_name?, customer_email?, customer_phone?, privacy_consent, privacy_consent_version }  (at least one of customer_email / customer_phone; company_name required for business_brand; 400 otherwise, see "Customer type and privacy consent")
Response: { success: true, receipt_id, access_token, created_at, message }   (no internal status)

GET /api/estimates/:receipt_id?token=xxx
Response: { receipt_id, category, specification_json, created_at, updated_at, message }   (no internal status)
Error:    { error: "Unauthorized", timestamp }
```

**Test Coverage**: ✅ 26 tests

---

## Phase 2 Day 2: File Upload and S3 Integration

**Overview**

Implemented multipart/form-data file upload with private S3 storage, magic-byte validation, and comprehensive compensation handling for partial failures.

**File Upload Features:**

1. **Multipart/Form-Data Handling**
   - Accept up to 5 files per estimate (PRD FR-2.6)
   - Accept JSON specification_json as form field
   - Backward compatible with existing application/json API

2. **File Validation**
   - MIME type whitelist: JPEG, PNG, WEBP, PDF (PRD FR-2.6; GIF is not allowed)
   - Magic bytes validation (prevent MIME type spoofing)
   - Extension validation (must match MIME type)
   - File size limits: 10MB per file, 30MB for all files of one request
   - Empty file rejection
   - Supports both .jpg and .jpeg extensions

3. **S3 Integration**
   - AWS SDK v3 with private bucket
   - Server-side encryption (AES256/SSE-S3)
   - S3 key format: `estimates/{estimate_id}/{file_id}.{ext}`
   - Credentials via environment variables
   - No signed URLs (files remain in quarantine/pending_scan state)

4. **File State Management**
   - Initial state: `quarantine`
   - After validation queue: `pending_scan`
   - After ClamAV check: `approved` or `rejected`
   - ⚠️ **ClamAV integration not yet implemented** (files remain in pending_scan)

5. **Compensation Transaction Handling**

   **Multifile Failure Cleanup:**
   - Track all successfully uploaded files (ID, S3 key, estimate_id)
   - On ANY failure: delete all S3 objects AND DB file records
   - Prevent orphaned records in either system
   - Log each compensation step for audit trail

   **Estimate vs File Upload Architecture:**
   - Estimate creation: one READ COMMITTED transaction, atomic commit
   - File upload: Separate transaction (outside estimate transaction)
   - Design: **Partial success is allowed**
   - Rationale:
     - Estimate (customer request) is primary data
     - Files are secondary metadata
     - Receipt ID already issued and immutable
     - Estimate remains valid even if file upload fails
   - Result if file fails: Estimate exists, files do not
   - Client receives: HTTP 500 error

   **Known Limitation:**
   - ⚠️ **No file-only retry endpoint yet**
   - Current behavior: Client retry creates NEW estimate (not idempotent)
   - Workaround: Customer can retry with new estimate or retry entire request

**API Changes:**

```
POST /api/estimates
Accept: multipart/form-data or application/json

Multipart example:
  --formdata
  category: "optical"
  specification_json: "{...json...}"
  files[0]: <JPEG file>
  files[1]: <PDF file>

Response (success with files):
{
  success: true,
  receipt_id: "BP20260930001",
  access_token: "...",
  created_at: "2026-09-30T...",
  message: "<CUSTOMER_GUIDANCE_MESSAGE>",
  files: [
    { id: "file-uuid-1", filename: "photo.jpg", size: 102400, status: "quarantine" },
    { id: "file-uuid-2", filename: "spec.pdf", size: 204800, status: "quarantine" }
  ]
}

Response (validation error):
{
  error: "File validation failed",
  details: [
    { filename: "doc.docx", errors: ["MIME type application/vnd... is not allowed"] },
    { filename: "large.jpg", errors: ["File size exceeds 10MB limit"] },
    { filename: "", errors: ["Too many files: at most 5 files per request"] }
  ],
  timestamp: "2026-09-30T..."
}

Response (file upload error):
HTTP 500: { error: "File upload failed", code: "FILE_UPLOAD_FAILED", timestamp: "..." }
// Nothing was saved: no estimate, no receipt number (see "All or nothing" below)
```

**Implementation Details:**

- **fileService.ts**:
  - `uploadFileWithMetadata()`: Single file with DB + S3 transaction
  - `deleteFileMetadata()`: Remove file record from DB
  - `uploadMultipleFilesWithMetadata()`: Batch upload with compensation

- **s3Service.ts**:
  - `uploadFileToS3()`: PutObjectCommand with SSE-S3
  - `deleteFileFromS3()`: DeleteObjectCommand for compensation

- **fileValidation.ts**:
  - `validateFileBuffer()`: Magic bytes + extension + size checks
  - `generateSafeFileId()`: UUID without hyphens
  - `getFileExtension()`: Lowercase extraction, handles missing extensions

- **upload.ts middleware**:
  - Multer configuration with size/file count limits
  - `extractMultipartData()`: Parse form fields including JSON specification

**Test Coverage**: ✅ 78 total tests
- Specification validation: 26 tests
- Estimates API: 42 tests (including HTTP response filtering)
- Compensation strategy & file handling: 10 tests

**Actual Test Results:**
```
Test Suites: 3 passed, 3 total
Tests:       78 passed, 78 total
```

**Integration Testing Status:**
- ✅ Unit tests: All 78 passing
- ❌ AWS integration: Not tested (DATABASE_URL, AWS credentials not configured)
- ❌ ClamAV integration: Not implemented

**Future Work (Phase 2 Day 3+):**

```
POST /api/estimates/:receipt_id/files
- Upload files to existing estimate without creating new one
- Requires valid access token
- Idempotent: same token + files = same result (no duplicate uploads)

or implement idempotency key approach:
- POST /api/estimates?idempotency_key=xxx
- Retry same request with same key = returns previous receipt_id (no new estimate)
- Enables safe retry semantics for file upload failures
```

**Last Updated**: 2026-09-30  
**Next Phase**: Phase 2 Day 3 - Email Notifications (SendGrid)

---

## Phase 2 Day 3: Email Notifications (SendGrid Integration)

**Overview**

Implemented asynchronous email notification system using database-driven outbox pattern with two-stage processing:
- Stage A: Claim pending events with short DB transaction (FOR UPDATE SKIP LOCKED)
- Stage B: Send via SendGrid outside transaction to avoid holding DB locks

**Email Types:**
- **receipt**: Customer quote confirmation (receipt_id, status, created_at, guidance)
- **admin_notification**: Admin alert for new quote (receipt_id, status, created_at, guidance)

**Outbox Pattern Architecture:**

```
Estimate Creation Transaction:
┌─ READ COMMITTED Transaction ───────────────┐
│ 1. Generate Receipt ID                     │
│ 2. Insert estimate + token                 │
│ 3. Queue email_events (idempotency_key)    │
│ 4. COMMIT (all or nothing)                 │
└────────────────────────────────────────────┘
          ↓ (on success)
┌─ Email Worker (async, outside transaction) ┐
│ Stage A: Claim events (FOR UPDATE SKIP LOCKED)
│   - SELECT pending events, mark as 'sending'
│   - COMMIT (lock released)                 │
│                                            │
│ Stage B: Process each event                │
│   - Call SendGrid API                      │
│   - Mark as 'sent' or schedule retry       │
└────────────────────────────────────────────┘
```

**Key Features:**

1. **Transaction Safety (Outbox Pattern)**
   - Estimate + email_events creation in a single READ COMMITTED transaction
   - If email_events INSERT fails → entire estimate creation rolls back
   - If SendGrid fails → estimate exists, email scheduled for retry (at-least-once semantics)
   - Idempotency key prevents duplicate queue entries (UNIQUE constraint)

2. **Two-Stage Processing**
   - **Stage A**: Claim events with short DB transaction
     - `FOR UPDATE SKIP LOCKED` ensures no duplicate processing
     - Lock released immediately after marking as 'sending'
   - **Stage B**: Send email outside DB transaction
     - No DB locks held during SendGrid API call
     - Prevents long-running API from blocking other queries
     - Enables horizontal scaling (multiple workers)

3. **Retry Logic with Exponential Backoff**
   - Total 4 attempts (1 initial + 3 retries)
   - retry_count semantics:
     - 0: Initial (before first sending attempt)
     - 1: First attempt failed, retry in 1min
     - 2: Second attempt failed, retry in 2min
     - 3: Third attempt failed, retry in 4min
     - >3: Mark as failed (no more retries)
   - Maximum retry count enforced: never exceeds 3

4. **Stale Event Recovery**
   - Detect events stuck in 'sending' state (> 5 minutes old)
   - If retry_count < 3: move back to pending, reschedule
   - If retry_count = 3: mark as failed (final attempt exhausted)
   - Recovers from worker crashes without manual intervention

5. **Email Worker Lifecycle**
   - Runs in background every 30 seconds (configurable)
   - Auto-disabled in test environment (NODE_ENV=test)
   - Can be disabled via EMAIL_WORKER_ENABLED=false
   - Graceful shutdown via `stopEmailWorker()` for Jest cleanup

6. **SendGrid Integration**
   - If SENDGRID_API_KEY is not set, no email is actually sent and nothing is marked as sent (no fake message IDs)
   - Without an API key, events stay in pending/retry state (retry_count advances per the retry schedule, and events end as failed after retries are exhausted)
   - `provider_message_id` stores the SendGrid message ID for delivery tracking only; it does not prevent duplicate sends
   - `idempotency_key` (UNIQUE) only prevents duplicate rows in the DB queue
   - If the server stops after the SendGrid call succeeds but before the DB update, the email may be sent again (at-least-once)
   - Credentials via environment variables (never hardcoded)

7. **Data Privacy**
   - Email body contains only: receipt_id, status, created_at, guidance
   - No access tokens, customer emails, API keys, or passwords
   - Error logs truncated to 100 chars (prevents credential leaks)
   - Sensitive data marked [REDACTED] in logs

**Configuration:**

```env
# SendGrid settings (required for actual sending)
SENDGRID_API_KEY=              # SendGrid API key
SENDGRID_FROM_EMAIL=           # Must be authenticated in SendGrid account
ADMIN_NOTIFICATION_EMAIL=      # Admin's email for receipt alerts

# Email worker settings (optional)
EMAIL_WORKER_ENABLED=false     # Default: disabled (set to true in production)
EMAIL_WORKER_INTERVAL_MS=30000 # 30 seconds (polling interval)
EMAIL_WORKER_STALE_TIMEOUT_MS=300000 # 5 minutes (stale event threshold)
```

⚠️ **Important Notes:**
- SENDGRID_FROM_EMAIL must be a verified sender address in your SendGrid account
  - Use Domain Authentication or Single Sender Verification
  - Unverified addresses will cause 403 Forbidden errors
- EMAIL_WORKER_ENABLED=false in .env.example (enable explicitly in production)
- Test environment automatically disables worker (NODE_ENV=test)

**Test Coverage**: ✅ 91 tests at the end of Phase 2 Day 3 (Phase 3 Week 1 raised the total to 208)
- Specification validation: 26 tests
- Estimates API: 42 tests
- File upload & compensation: 10 tests
- Email service & retry logic: 13 tests

**Actual Test Results:**
```
Test Suites: 4 passed, 4 total
Tests:       91 passed, 91 total   (Phase 2 Day 3 snapshot; see the Phase 3 section for current totals)
```

**Known Limitations & Guarantees:**

| Aspect | Status | Notes |
|--------|--------|-------|
| **Email Delivery** | at-least-once | If server crashes after SendGrid succeeds but before DB update, duplicate send possible |
| **Idempotency** | Queuing only | `idempotency_key` prevents duplicate DB queue entries only; `provider_message_id` is for tracking and does not prevent duplicate sends |
| **ClamAV Scanning** | Not implemented | Files remain in quarantine state; virus scanning deferred |
| **Signed URLs** | Not implemented | Download endpoint deferred |
| **File Retry API** | Not implemented | File upload failures require new estimate; dedicated retry endpoint deferred |

**Integration Testing Status:**
- ✅ Unit tests: 91/91 passing (pure logic tests; no real DB, AWS, or SendGrid calls)
- ✅ Transaction safety: verified (Outbox pattern)
- ❌ SendGrid integration: Not tested (requires API key in .env)
- ❌ Actual email delivery: Not tested (requires SendGrid account)

**Database Schema Changes:**

Migration file: `007_email_events_schema_enhancement.ts`
- New columns: next_retry_at, last_error, provider_message_id, updated_at
- New indexes: idx_email_events_next_retry, idx_email_events_updated_at
- Supports efficient pending/stale event queries

**Implementation Files:**

- `src/services/emailService.ts`: Queue, claim, and retry management
- `src/services/emailWorker.ts`: Background worker loop, two-stage processing
- `src/db/migrations/007_email_events_schema_enhancement.ts`: Schema changes
- `src/config/env.ts`: SendGrid and worker configuration
- `src/__tests__/emailService.test.ts`: Retry logic and state management tests

**Last Updated**: 2026-10-13
**Phase 2 Status**: Days 1-3 complete (Estimates, Files, Email Notifications); Days 4-7 pending

---

## Customer contact policy (PRD FR-4.2)

At least one of `customer_email` or `customer_phone` is required. `customer_email` is optional.

- API: `POST /api/estimates` returns 400 `Missing required contact: customer_email or customer_phone` when both are absent or blank, and 400 `Invalid customer information` (with `details`) for format/length errors.
- DB: migration `008_customer_contact_policy.ts` makes `customer_email` nullable and adds the CHECK `estimates_contact_required`, so the API and the database enforce the same rule. Earlier migrations were not modified.
- Without an email, the customer receipt email is skipped; the admin notification is still created.
- Field rules: `customer_email` max 100 chars and a valid address, `customer_phone` max 20 chars with 7-15 digits (digits, spaces, `+`, `-`, `( )` only, `+` only at the start), `customer_name` and `company_name` max 100 chars. Values are trimmed; control characters are rejected.
- Rolling back migration 008 fails if any estimate has a NULL `customer_email`; resolve those rows first. The integration suite checks exactly this: the error log line about a NULL `customer_email` (SQLSTATE 23502) during the run is the **intended** failure of that test, which then verifies that the migration stayed recorded, the constraint stayed in place, the column stayed nullable and the knex migration lock was released.

**Verification status**: covered by unit tests with a mocked database and, for migration 008 and its CHECK constraint (apply, constraint, refused rollback with a NULL e-mail, rollback after cleanup), by the integration suite on PostgreSQL 16.15.


---

## Customer type and privacy consent (PRD FR-4.2)

`POST /api/estimates` needs the customer type and the privacy consent in addition to the contact. They are stored in `estimates.customer_type`, `privacy_consent_at` and `privacy_consent_version` (migration `012_customer_type_and_privacy_consent.ts`).

| Field | Required | Rule |
|---|---|---|
| `customer_type` | yes | `individual_startup` or `business_brand`, nothing else |
| `customer_name` | yes, for both types | max 100 characters (same rules as before) |
| `company_name` | yes for `business_brand` | the company **or brand** name, max 100 characters; optional for `individual_startup` |
| `customer_email` / `customer_phone` | at least one | unchanged (see the contact policy above) |
| `privacy_consent` | yes | the boolean `true`. In `multipart/form-data`, which has no booleans, the text `true` stands for `true`; `True`, `1`, `on`, `yes`, an empty value and, in JSON, the text `"true"` are refused |
| `privacy_consent_version` | yes | one of the versions the server accepts (see below); an unknown version is refused without being echoed back |

Labels (the API only knows the codes; the front end maps them):

| `customer_type` | Label shown to the customer (PRD FR-4.2) |
|---|---|
| `individual_startup` | 개인·창업 준비 중 |
| `business_brand` | 사업자·브랜드 운영 중 |

The screen should make clear that the first option is for people preparing to start a business or asking about making or sourcing a product, not for consumers shopping for a finished product (PRD FR-4.2).

- **Same rules for JSON and multipart.** Everything is validated **before** the transaction and before a receipt number is taken. A refused request writes nothing: no estimate, no change of `receipt_sequence`, no e-mail event. Names, e-mail addresses, company names and consent values are never written to the log.
- **Errors** keep the existing shape: `400 { "error": "Invalid customer information", "details": [{ "field": "customer_type", "message": "must be one of: individual_startup, business_brand" }, { "field": "privacy_consent", "message": "must be true" }], "timestamp": "..." }`. When the contact is the only thing missing the old message `Missing required contact: customer_email or customer_phone` is kept. Unknown extra fields are ignored, not rejected.
- **The consent time belongs to the server.** `privacy_consent_at` is set by the insert (`CURRENT_TIMESTAMP`, the database time, in the same transaction as the estimate). A time sent by the client (`privacy_consent_at`, `consent_at`, ...) is ignored. **The IP address and the User-Agent are not stored.**
- **Who sees it.** The privacy consent is shown **only in the admin detail** (`GET /admin/estimates/:id`: `customer_type`, `privacy_consent_at` as an ISO time, `privacy_consent_version`); the admin list shows only `customer_type`. The customer answers (`201` of the creation and `GET /api/estimates/:receipt_id`) contain neither personal data nor consent. There is no filter or search by customer type yet.
- **Existing requests** (received before migration 012) keep `NULL` in all three columns: no consent was recorded for them and none is invented. The admin API answers `null` for them and everything else works as before (status changes included).
- **The database** only checks consistency: `customer_type` is one of the two codes or `NULL` (`estimates_customer_type_check`), and `privacy_consent_at` and a non-blank `privacy_consent_version` come together or are both `NULL` (`estimates_privacy_consent_consistent`). Whether a new request must carry them is decided by the API. Rolling back migration 012 is **refused** while any estimate holds a customer type or a consent, because dropping the columns would destroy those records; the integration test of this refusal logs an error on purpose (see docs/TESTING.md).

### Consent text and versions

The wording of the consent has **not been written**: it needs legal and operational review. Only the structure exists (`src/config/privacyConsent.ts`):

- `dev-draft` is a placeholder accepted **only in `development` and `test`**; production (and any other environment) refuses it with `400`.
- Production accepts only the versions in `APPROVED_CONSENT_VERSIONS`, which is **empty** until a text is approved. **While it is empty, every `POST /api/estimates` in production answers `503` with `code: "PRIVACY_CONSENT_NOT_CONFIGURED"`**, before any parsing, validation or storage, and the server logs a warning at start. The health check, the admin API and the customer lookup keep working.
- The text of an approved version lives in `docs/privacy-consent/<version>.md` (a unit test requires the file for every approved version), so the wording and the list are reviewed and committed together. A version is at most 50 characters (letters, digits, `.`, `_`, `-`).

### Request contract for the front end (Phase 4)

The existing estimate pages do not collect these fields yet; the contact step has to be added. JSON example:

```json
{
  "category": "shoes",
  "specification_json": { "...": "..." },
  "customer_type": "business_brand",
  "customer_name": "Kim",
  "company_name": "Acme",
  "customer_email": "buyer@example.com",
  "privacy_consent": true,
  "privacy_consent_version": "<the version of the text that was shown>"
}
```

With files, send `multipart/form-data` with the same field names: `customer_type`, `customer_name`, `company_name`, `customer_email`, `customer_phone`, `privacy_consent` (the text `true`) and `privacy_consent_version`, plus `category`, `specification_json` (a JSON string) and `files`. The version sent must be the identifier of the text the customer actually saw.

### Before opening estimate intake in production

1. The consent text is reviewed and approved, saved as `docs/privacy-consent/<version>.md`, and the version is added to `APPROVED_CONSENT_VERSIONS` (without it production answers 503). A draft to start from, with the items that Bridge Path must decide (retention, the transfer of the photo to the AI service abroad, the processors): `docs/privacy-consent/DRAFT-2026-10-20.md`. It is not an approved version.
2. `TRUST_PROXY=1` on Heroku (otherwise all customers share one rate-limit budget; see "Rate limiting and TRUST_PROXY").
3. Migration 012 is applied and one server instance is running (the rate limits are per process).
4. A retention period and deletion process for personal data is decided; none is implemented yet.

---

## What customers see after an estimate request (PRD FR-4.9.2, FR-4.9.3)

Customers never see the internal status of their request (PRD FR-4.9.3). The status is stored (a new request is `new_receipt`) and used by the admin API; what the customer is told is a fixed explanation instead (FR-4.9.2).

**Creating a request** (`POST /api/estimates`, `201`):

```json
{
  "success": true,
  "receipt_id": "BP20261013001",
  "access_token": "<64 hex characters>",
  "created_at": "2026-10-13T03:00:00.000Z",
  "message": "<CUSTOMER_GUIDANCE_MESSAGE>"
}
```

With uploaded files the answer also has `files` (`id`, `filename`, `size`, `status`). That `status` is the scan state of the **file** (for example `quarantine`), not the status of the request.

**Looking a request up** (`GET /api/estimates/:receipt_id?token=...`, `200`): `receipt_id`, `category`, `specification_json`, `created_at`, `updated_at` and `message`. The answer is built field by field in the route, so nothing the service might add later can reach the customer, and the query does not even read the status column. The old `status` field is gone from both answers (a breaking change for a client that read it; there is none yet).

**The fixed message** (`CUSTOMER_GUIDANCE_MESSAGE` in `src/utils/customerMessages.ts`, the only place of this text; the sentence of PRD FR-4.9.2, word for word):

> 견적 요청이 정상적으로 접수되었습니다. 담당자가 요청 내용과 제품 사양을 검토한 후 필요한 경우 추가정보를 요청하고, 공장 확인을 거쳐 정식견적을 안내드립니다.

The PRD allows the final wording to be polished in the UX and content step as long as the meaning stays, and asks to avoid phrases that sound like a promise of time ("빠른 시일 내", "곧", "최대한 신속하게"). A unit test checks that the constant still appears verbatim in the PRD and contains no such phrase. The front end shows `message` on the receipt screen.

**Customer e-mail** (the receipt e-mail queued with the request): subject `Bridge Path 접수 완료: <receipt number>`; body with the message above, the receipt number and the receipt time. It has **no status row, no status code and no promise of time**; the former sentence "저희 팀에서 빠른 시일 내에 연락드리겠습니다" was removed for that reason.

**What stays internal.** The admin API (`/admin/estimates`, the status change and the status history) and the **admin notification e-mail** keep showing the internal status, because staff work with it. The status values and their meaning for staff are described under "Status transitions".

---

## Phase 3: Admin API (in progress)

**Plan**: 3 weeks.
- Week 1: estimate list/detail, auth and roles, status change.
- Week 2: memos, file metadata and blocked downloads, password change, login lockout fix, rate limiting (implemented; see the Week 2 sections below).
- Week 3: test hardening, integration test preparation, documentation, security review, CI (implemented).

Actual ClamAV integration and enabling file downloads are **follow-up work** (see "Required before public launch").

**Verification status**: the unit tests use a mocked database (supertest + jest mocks). The SQL (row locking, filters, search, memo and password queries, migrations 008 to 013) and the concurrency behaviour (parallel estimate creation, failed-login counting, login versus password change) are additionally covered by nine local integration suites that passed on PostgreSQL 16.15 (253 tests; see [docs/TESTING.md](docs/TESTING.md)).
Phase 3 does not call AWS or SendGrid, and the real AWS/SendGrid integration tests from Phase 2 have not been run because credentials are not configured: AWS and SendGrid remain unverified. The SendGrid 8.x upgrade was checked only against a local stub server.

### Admin endpoints (Week 1)

All routes live under `/admin/estimates`, use the existing HttpOnly cookie authentication, and are available to both `admin` and `manager`. `:id` is `estimates.id` (UUID), **not** the receipt id (`receipt_id` is a response field only).

| Method and path | Description |
|---|---|
| `GET /admin/estimates` | Paginated list. Query: `page` (default 1), `limit` (default 20, max 100), `status` (comma-separated), `category`, `created_from` / `created_to` (`YYYY-MM-DD`, Korea time, inclusive), `q` (search), `sort` (`created_at`, `updated_at`, `status`, `receipt_id`), `order` (`asc`/`desc`, default `desc`) |
| `GET /admin/estimates/:id` | Detail: estimate, file metadata, status history, memos |
| `PATCH /admin/estimates/:id/status` | Body `{ to_status, reason?, expected_status? }` |

- `q` matches the receipt id (prefix), company name, customer name, customer email (contains) and, when `q` looks like a phone number (4+ digits), the customer phone with formatting ignored. This supports the PRD FR-4.10 recovery path (finding a request from customer details).
- The list returns minimal personal data: `id`, `receipt_id`, `category`, `status`, `company_name`, `customer_name`, `customer_type`, `created_at`, `updated_at`, `file_count`. The detail adds the customer type and the privacy consent (`customer_type`, `privacy_consent_at`, `privacy_consent_version`); the consent is shown **only in the detail**. Customer email, phone and `specification_json` appear only in the detail response.
- Never returned: customer access tokens or hashes, password hashes, refresh/access token hashes, `s3_key`, `virus_scan_result`.
- Responses: `{ success: true, data, pagination? }`. Errors: `{ error, code, timestamp }`.
- An account flagged `must_change_password` gets 403 `PASSWORD_CHANGE_REQUIRED` on every admin route except the password change and logout (see Admin account initialization).
- Mutating requests must use `Content-Type: application/json` (415 otherwise). Malformed JSON returns 400 `INVALID_JSON`.
- Audit logging: detail views and status changes (including denied attempts) are written to the application log as `admin_audit {...}` with only whitelisted fields (admin id, role, action, result, estimate id, statuses, IP). Memo text, reasons and email content are never logged. Detail views and denied attempts exist only in logs, which are not durable on Heroku; status changes are also stored permanently in `status_history`.
- The detail response includes at most the latest 200 status history entries and the latest 100 memos.
- Audit entries record the client IP from `req.ip`. Behind a proxy (Heroku) set `TRUST_PROXY=1`, otherwise this is the proxy address (see the rate limiting section).
- Customer status emails (`email_events.email_type = 'status_update'`) are **not sent** in Phase 3. The type is reserved for future work.

### Admin memos (Week 2)

Internal notes on an estimate. Both `admin` and `manager` can read and write. `:id` is `estimates.id` (UUID).

| Method and path | Description |
|---|---|
| `POST /admin/estimates/:id/memos` | Create a memo. Body `{ content }`. Returns 201 with `{ id, estimate_id, content, author: { id, username }, created_at }` |
| `GET /admin/estimates/:id/memos` | Newest first. Query `page` (default 1), `limit` (default 20, max 100). Returns `data` and `pagination` |

- `content` is trimmed and must be **1-5000 characters** (counted as characters/code points, not bytes). Newlines and tabs are allowed; other control characters are rejected.
- The author is always the authenticated admin (`req.admin.id`). An `author` or `admin_user_id` in the request body is ignored.
- The estimate check and the insert are a single SQL statement, so a memo is never written for a missing estimate (404 `ESTIMATE_NOT_FOUND`).
- Memos cannot be edited or deleted in this phase.
- Memo text appears only in these two endpoints and in the estimate detail (latest 100). The estimate list never includes memo text or counts.
- Memos are stored and returned as plain text. A client that renders them in HTML must escape them.
- Audit log: `memo.create` and `memo.list.view` record only admin id, role, estimate id, memo id, result and IP. The memo text (and its length) is never logged.

| HTTP | Code | Situation |
|---|---|---|
| 400 | `INVALID_ID` | `:id` is not a UUID |
| 400 | `VALIDATION_ERROR` | `content` missing, not a string, blank, or contains control characters; invalid `page`/`limit` |
| 400 | `MEMO_TOO_LONG` | more than 5000 characters |
| 404 | `ESTIMATE_NOT_FOUND` | estimate does not exist |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST without `Content-Type: application/json` |

**Database constraint (migration `010_admin_memos_content_check.ts`)**: `CHECK (char_length(content) BETWEEN 1 AND 5000)` on `admin_memos.content`, the same limit as the API.
- Applying it fails if `admin_memos` already holds an empty or longer-than-5000-character row. No memo API existed before this phase, so none is expected; check manually-inserted rows first.
- Rolling back only drops the constraint and is always safe.
- Not run against a real PostgreSQL yet (see the verification status below).

### Admin file metadata and blocked downloads (Week 2)

File **downloads are intentionally blocked** in this phase. Only metadata is available to admins.

| Method and path | Description |
|---|---|
| `GET /admin/estimates/:id/files` | File metadata of an estimate: `id`, `filename`, `file_size`, `mime_type`, `file_status`, `virus_scan_status`, `uploaded_at`, `downloadable` |
| `GET /admin/estimates/:id/files/:fileId/download` | Always answers 403 `FILE_NOT_APPROVED` today |

- Never returned or selected: `s3_key`, `virus_scan_result`, `scanned_at`. The estimate detail uses the same file shape (including `downloadable`).
- Why blocked: ClamAV scanning is not implemented and nothing ever sets a file to `approved`/`passed`; uploaded files stay `quarantine`/`pending`. There is no manual approval feature.
- The download endpoint checks that the file belongs to the estimate in the URL (`files.id = $fileId AND estimate_id = $id`); otherwise 404 `FILE_NOT_FOUND`. Every attempt, including blocked and not-found ones, is audit-logged as `file.access.attempt` (admin, estimate id, file id, result, no file name or key).
- No S3 call is made and no signed URL is issued. `s3Service.ts` has no read/sign code and `@aws-sdk/s3-request-presigner` is not installed.
- `FILE_DOWNLOAD_ENABLED` defaults to `false`. Setting it to `true` while only the placeholder `DisabledDownloadProvider` exists **stops the server at startup** (`createApp` throws), so the flag can never be silently ignored.
- Prepared structure for later: `src/services/fileDownload.ts` has the `DownloadUrlProvider` interface and `decideFileDownload`, which allows a download only if the flag is on, a real provider exists, and the file is `approved` + `passed`. Enabling downloads is **follow-up work** (ClamAV scanning, a signed-URL provider, then the flag).

| HTTP | Code | Situation |
|---|---|---|
| 400 | `INVALID_ID` | estimate id or file id is not a UUID |
| 403 | `FILE_NOT_APPROVED` | download requested (always, for now) |
| 404 | `ESTIMATE_NOT_FOUND` | metadata requested for a missing estimate |
| 404 | `FILE_NOT_FOUND` | file missing or belonging to another estimate |

### Status transitions

The 10 statuses of PRD FR-5.5 are the only values the `estimates.status` CHECK constraint allows (since migration 013). The table below (28 transitions) is mirrored in `src/utils/statusTransitions.ts`; `statusTransitions.test.ts` fails if the two differ. `admin` may perform every listed transition; `manager` only those marked allowed.

<!-- STATUS_TRANSITIONS:START -->
| Current status | Next status | manager | admin | reason required |
|---|---|---|---|---|
| new_receipt | under_review | allowed | allowed | no |
| new_receipt | cancelled | denied | allowed | yes |
| under_review | info_requested | allowed | allowed | no |
| under_review | factory_checking | allowed | allowed | no |
| under_review | quoted | allowed | allowed | no |
| under_review | on_hold | allowed | allowed | yes |
| under_review | cancelled | denied | allowed | yes |
| info_requested | under_review | allowed | allowed | no |
| info_requested | on_hold | allowed | allowed | yes |
| info_requested | cancelled | denied | allowed | yes |
| factory_checking | quoted | allowed | allowed | no |
| factory_checking | info_requested | allowed | allowed | no |
| factory_checking | on_hold | allowed | allowed | yes |
| factory_checking | cancelled | denied | allowed | yes |
| quoted | customer_review | allowed | allowed | no |
| quoted | accepted | allowed | allowed | no |
| quoted | on_hold | allowed | allowed | yes |
| quoted | cancelled | denied | allowed | yes |
| customer_review | accepted | allowed | allowed | no |
| customer_review | quoted | allowed | allowed | no |
| customer_review | factory_checking | allowed | allowed | no |
| customer_review | on_hold | allowed | allowed | yes |
| customer_review | cancelled | denied | allowed | yes |
| accepted | completed | allowed | allowed | yes |
| accepted | on_hold | allowed | allowed | yes |
| accepted | cancelled | denied | allowed | yes |
| on_hold | under_review | allowed | allowed | no |
| on_hold | cancelled | denied | allowed | yes |
<!-- STATUS_TRANSITIONS:END -->

`completed` and `cancelled` are end points: nothing leaves them. `quoted → accepted` is possible directly, and also through `quoted → customer_review → accepted`. A reason is required for `on_hold`, `cancelled` and `accepted → completed`; only an `admin` may cancel. Any pair not listed above is invalid.

**Status change errors** (checked in this order after the estimate row is locked):

| Order | Situation | HTTP | Code |
|---|---|---|---|
| 1 | `:id` is not a UUID | 400 | `INVALID_ID` |
| 1 | `to_status` or `expected_status` is not one of the 10 statuses | 400 | `INVALID_STATUS` |
| 1 | Body is malformed (missing `to_status`, `reason` too long, wrong types) | 400 | `VALIDATION_ERROR` |
| 2 | Estimate does not exist | 404 | `ESTIMATE_NOT_FOUND` |
| 3 | `expected_status` differs from the current status (response includes `current_status`) | 409 | `STATUS_CONFLICT` |
| 4 | `to_status` equals the current status | 422 | `SAME_STATUS` |
| 5 | Transition is not in the table | 422 | `INVALID_TRANSITION` |
| 6 | Transition exists but the role is not allowed (manager) | 403 | `INSUFFICIENT_ROLE` |
| 7 | `reason` is required but missing | 422 | `REASON_REQUIRED` |

The estimate row is locked with `SELECT ... FOR UPDATE` in a READ COMMITTED transaction, and the `estimates` update and the `status_history` insert are committed together. `updated_at` is set explicitly (there is no trigger).

### Statuses of the PRD and migration 013

These are the ten statuses of PRD FR-5.5 (an internal **processing status** of an estimate request). The API uses the code; the label is what staff and the admin screens show. Customers never see either (see "What customers see after an estimate request").

| Code | Label (PRD) | Meaning (PRD) |
|---|---|---|
| `new_receipt` | 신규 접수 | stored, not yet looked at by staff |
| `under_review` | 정보 확인 중 | staff review the request and the attached files |
| `info_requested` | 추가정보 요청 | information is missing; the customer was asked for more |
| `factory_checking` | 공장 견적 확인 중 | price and terms are being checked with factories and partners |
| `quoted` | 정식견적 발송 | the formal quotation was sent to the customer |
| `customer_review` | 고객 검토 중 | waiting for the customer's answer after the quotation |
| `accepted` | 진행 확정 | the customer accepted the formal quotation (contract and payment follow outside the service) |
| `on_hold` | 보류 | paused for the customer's or staff's reasons |
| `completed` | 종결 | the inquiry is finished (not a production or delivery state) |
| `cancelled` | 취소 | cancelled at the customer's request or because it cannot be done |

**Retired statuses.** Migration 013 removed three statuses that the PRD does not have. No estimate has them any more:

| Retired code | Today's equivalent |
|---|---|
| `rejected` | `cancelled` |
| `archived` | `completed` |
| `negotiating` | `customer_review` |

**`status_history` keeps the statuses of its time.** It is an audit trail, so migration 013 does **not** change it, neither when it is applied nor when it is rolled back: an old entry can still read `completed → archived`, `quoted → negotiating` or `under_review → rejected`, and such an entry is not turned into a self-transition. `GET /admin/estimates/:id` returns `old_status` and `new_status` exactly as stored and adds `retired_status` to each entry of `status_history`: `true` when `old_status` or `new_status` is one of the retired codes, otherwise `false` (an entry without an old status, the first one, is `false`). A client can use it to mark a name as "former status" and show the equivalent from the table above. `retired_status` is an admin field only; it never appears in a customer answer.

**Admin API.**
- The list filter `status=` takes any of the ten codes (comma separated). The retired codes are refused with `400 INVALID_STATUS`, like `to_status` and `expected_status` in a status change.
- `info_requested` and `factory_checking` can be set (`under_review → info_requested`, `under_review → factory_checking`, ...) as the transition table says. `negotiating` is now `customer_review`: `quoted → customer_review` replaces `quoted → negotiating`. `rejected` and `archived` are gone: cancel with a reason instead; `completed` and `cancelled` are end points.
- The error table above is unchanged. The roles are unchanged: `manager` for the working flow, `admin` to cancel.

**Migration `013_align_estimate_statuses.ts`** (one transaction):
1. Lock `estimates` (`ACCESS EXCLUSIVE`): a status change that is still open is waited for and its result is migrated.
2. Create `estimate_status_backup` (`estimate_id`, `original_status`, `migrated_status`) and save, for the estimates it will change, the status they have (`rejected`, `archived`, `negotiating`) and the one they get.
3. Find the old CHECK on `estimates.status` in the catalog (it was created without a name in migration 001) and drop it.
4. Change `estimates.status` only: `rejected → cancelled`, `archived → completed`, `negotiating → customer_review`. `updated_at` is not changed (it is not a change made by a user).
5. Add `estimates_status_check` with exactly the ten statuses above.

**Rolling back 013**, in this order, in one transaction (a failure anywhere undoes everything, the dropped CHECK included):
1. Lock `estimates`.
2. **Refuse, changing nothing, while an estimate is in `info_requested` or `factory_checking`**: the previous status set has no equivalent. Move those estimates to another status first.
3. Drop the new CHECK (it forbids the old statuses, so it must go before they are restored).
4. Restore `rejected`, `archived` and `negotiating` from `estimate_status_backup`, but only for an estimate that still has the status the migration gave it: a row that was changed since is not overwritten.
5. Rename the remaining `customer_review` estimates (also those created after the migration) back to `negotiating`.
6. Check that every status is one of the old ten, otherwise fail.
7. Create the original CHECK again (the ten statuses of migration 001).
8. Drop `estimate_status_backup`.

`status_history` is not read or written by either direction. The integration test of the refusal (and the one of migration 012) **logs an error on purpose**; see docs/TESTING.md.

### Admin password change (Week 2)

`PATCH /admin/me/password` changes the password of the signed-in admin (any role). There is no endpoint to change someone else's password.

Request: `{ "current_password": "...", "new_password": "..." }` (JSON only). Passwords are never trimmed or altered.

**New password rules** (characters and bytes are different units and both apply):
- **At least 12 characters**, counted as Unicode code points. A Korean syllable is one character (3 bytes), so 12 Korean characters pass the length rule.
- **At most 72 bytes in UTF-8.** bcrypt only uses the first 72 bytes, so a longer password is **rejected with 400 `PASSWORD_TOO_LONG` and never truncated**. In bytes: 72 ASCII characters, or 24 Korean characters, or a mix such as 23 Korean characters + 3 ASCII characters.
- At least **3 of 4 character types**: lowercase, uppercase, digit, other (symbols, spaces, Korean...).
- No control characters. Must not equal the username, the email, the part of the email before `@` (case-insensitive), or the seeded default password `CHANGE_ME_ON_FIRST_LOGIN`.
- Must differ from the current password.
- Hash cost stays at **bcrypt 12 rounds**. The 72-byte guard also lives in `src/utils/hash.ts`: `hashPassword` throws `PASSWORD_TOO_LONG` and `comparePassword` returns `false` for longer input, so a long password can never match on its first 72 bytes (this also protects the login).

**What happens on success** (one database transaction):
1. The new hash is stored, `must_change_password` is cleared, and the failed-login counter and lock are cleared.
2. **Every session of this admin is revoked, the current one included.** The access token stops working immediately because each request checks the session in the database.
3. Both auth cookies are cleared.
4. The response is `200 { success, message, data: { reauthentication_required: true } }`. There is no automatic re-login: the admin must log in again, on every device, with the new password.

**Relation to account lockout** (5 failed attempts lock the account for 15 minutes; shared rules in `src/utils/loginLockout.ts`):
- A wrong current password counts as a failed attempt on the same counter as the login, and the 5th failure locks the account (which also blocks the login). A locked account gets 401 `ACCOUNT_LOCKED` without any password comparison.
- Policy violations and a same-as-current password do **not** count as failures and change nothing.
- A current password longer than 72 bytes is treated as wrong (counted) without calling bcrypt.
- A lock that has expired starts counting from zero. A success clears the counter and the lock.
- The admin row is locked with `FOR UPDATE` for the duration of the request (about half a second), so two simultaneous changes are serialized.

| HTTP | Code | Situation |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body is not an object, or a password is missing, empty or not a string |
| 400 | `PASSWORD_TOO_LONG` | new password is over 72 UTF-8 bytes (`details.max_bytes`) |
| 400 | `PASSWORD_POLICY_VIOLATION` | `details.violations` lists `TOO_SHORT`, `NOT_ENOUGH_CHARACTER_TYPES`, `CONTAINS_CONTROL_CHARACTERS`, `MATCHES_ACCOUNT_INFO`, `MATCHES_DEFAULT_PASSWORD` |
| 401 | `INVALID_CURRENT_PASSWORD` | current password is wrong (counted as a failed attempt) |
| 401 | `ACCOUNT_LOCKED` | account is locked |
| 401 | `ACCOUNT_UNAVAILABLE` | account no longer exists or is inactive |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | body is not JSON |
| 422 | `PASSWORD_SAME_AS_CURRENT` | new password equals the current one |

Passwords, hashes and tokens are never returned or logged. The audit entry `admin.password.change` records only admin id, role, result, error code and IP.

### Admin login lockout

Rules in `src/utils/loginLockout.ts`, shared by `POST /admin/login` and `PATCH /admin/me/password`:
- 5 consecutive failed attempts lock the account for 15 minutes. A locked account is refused (401 `Account is locked. Try again later.`), even with the right password, without any password comparison.
- **When a lock expires, the count starts again at 1** with the next failure (the same single `UPDATE` does it; there is no separate reset). Previously the counter stayed at 5, so a single typo after the lock re-locked the account for another 15 minutes; now a lock needs 5 fresh failures.
- **Failures are counted by the database, atomically** (`recordFailedLogin` in `src/services/loginAttempts.ts`): one `UPDATE ... RETURNING` increments from the stored value, so 4 parallel wrong passwords count exactly 4, and the password comparison (bcrypt) runs outside any row lock. A failure that arrives while a lock is active changes nothing (the counter stops at 5 and the lock is not extended). Requests refused with 429 never reach this code and are not counted.
- **Session refresh** (`POST /admin/token/refresh`) looks at the account again under a shared row lock: it runs in a short transaction that locks the `admin_users` row with `FOR SHARE`, checks that the account is still active, reads the role from that locked row and then rotates the refresh token with the existing compare-and-swap `UPDATE`. A deactivation or password change that is still in flight therefore cannot slip between the check and the rotation, while parallel refreshes do not block each other. Not part of this rule: deactivation does not revoke sessions, the refresh does not look at `locked_until`, and a reused refresh token is not detected.
- **A login and a password change are serialized on the admin row.** Before a session is created the login takes `SELECT ... FOR UPDATE` on the `admin_users` row and checks again that the password hash is still the one it verified, the account is active and not locked; otherwise it answers 401 and creates no session. Together with the change (which holds the same lock and revokes every session), no session can survive a password change.
- A successful login clears the counter and the lock.
- A failed attempt on the password change endpoint counts on the same counter.

### Rate limiting and TRUST_PROXY (Week 2)

Uses `express-rate-limit` with its default **in-memory store**. Exceeding a limit returns `429 { error, code: 'RATE_LIMITED', retry_after_seconds, timestamp }` with a `Retry-After` header and the standard `RateLimit` / `RateLimit-Policy` headers (draft-7), which are listed in `Access-Control-Expose-Headers` so a front end on another origin can read them. Limiters run before the request body is parsed.

| Limiter | Applies to | Counted per | Counts | Variables | Default |
|---|---|---|---|---|---|
| login | `POST /admin/login` | client IP | **failed requests only** (status 400 and above); successful logins are not counted | `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `_MAX` | 15 min / 10 |
| admin API | everything under `/admin` (login and token refresh included, also unauthenticated requests) | client IP | every request | `ADMIN_API_RATE_LIMIT_WINDOW_MS` / `_MAX` | 1 min / 120 |
| mutation | status change and memo creation (`/admin/estimates/*`, non-GET) | signed-in admin | every non-GET request | `ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS` / `_MAX` | 1 min / 30 |
| password change | `PATCH /admin/me/password` | signed-in admin | every request | `ADMIN_PASSWORD_RATE_LIMIT_WINDOW_MS` / `_MAX` | 15 min / 5 |
| estimate creation (public) | `POST /api/estimates` | client IP | **every request**, valid or not | `CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_WINDOW_MS` / `_MAX` | 1 hour / 10 |
| estimate lookup (public) | `GET /api/estimates/:receipt_id` | client IP | every request | `CUSTOMER_ESTIMATE_READ_RATE_LIMIT_WINDOW_MS` / `_MAX` | 15 min / 30 |

- Window is 1000 ms to 24 h and max is 1 to 100000. A missing or empty variable uses the default; an invalid value stops the server at startup.
- **The public limiters run before the JSON parser and before Multer**, which is mounted inside the `/api` router. A refused `POST /api/estimates` therefore parses no body, reads no uploaded file, writes nothing to S3 or the database, takes no receipt number and queues no e-mail. A refused lookup does not touch the one-time access token. Invalid requests count too, so the validation cannot be probed for free. The public limiters share no counter with the admin limiters and never touch an account's failed-login counter.
- Mutation and password limits follow the admin id (unauthenticated requests are rejected by authentication first and never use an admin's budget). Without a signed-in admin they fall back to the IP.
- **`TRUST_PROXY`** is the number of reverse proxies in front of the app (integer 0-10, default 0; Heroku: `1`). It decides which address `req.ip` reports, for rate limiting and for the audit log. `true` is deliberately not accepted because it would trust every `X-Forwarded-For` entry, which clients can forge. If it is too low, every client looks like the proxy and shares one budget; if it is too high, clients can pick their own IP.

**Relation to the account lockout** (5 failed attempts per account lock it for 15 minutes; independent of the IP limiter):
- Both apply. Whichever limit is reached first answers: with the default IP limit (10 failures / 15 min) the account lockout usually triggers first (401 "Account is locked") and other accounts on the same IP can still log in.
- Requests answered with 429 never reach the login code, so they do not advance the account's failure counter.
- Attempts on a locked account still count as failed requests for the IP limiter. Ten failed requests from one IP block that IP (including other accounts and the right password) until the window ends.
- A password change request uses the same account counter. The password limiter (5 per 15 min) and the lock threshold (5 failures) are equal on purpose: the sixth request within the window gets 429 before it can reach the lock check.

**Limits of the in-memory store (read before running more than one instance):**
- Counters live in each server process. With N instances (for example Heroku dynos) the effective limit is up to N times higher, and a request is only limited by the instance that served it.
- Counters reset on every restart and deploy.
- Use a shared store (for example Redis) before scaling out. This is follow-up work.
- Anyone who knows an admin username can lock that account for 15 minutes with 5 wrong passwords; the IP limiter does not prevent this from many addresses.
- **Single server only.** The public limits (creation: 10 per hour per IP; lookup: 30 per 15 minutes per IP) are also in process memory, so they are per server process, reset on restart and deploy, and are multiplied by the number of instances. Run **one** instance until a shared store exists. They stop casual abuse from one address; they do not stop a distributed attack, and a client that changes IP address (mobile networks, proxies) gets a fresh budget.
- **With `TRUST_PROXY=0` behind a proxy (Heroku) all customers share one IP and one budget**: after 10 creations in an hour nobody could submit a request. Set `TRUST_PROXY=1` on Heroku; the server logs a warning at start in production when it is 0 but cannot detect the proxy itself.
- Customers behind one shared address (an office, a school) share one budget too. Raise `CUSTOMER_ESTIMATE_CREATE_RATE_LIMIT_MAX` if that becomes a problem.

In tests every `createApp()` creates its own limiters and counters, and `createApp({ rateLimits, trustProxy })` accepts small limits, so no test depends on real time or on another test.

### Migrations added in Phase 3

- `008_customer_contact_policy.ts`: contact policy (above).
- `009_admin_api_indexes.ts`: `idx_estimates_status_created_at`, `idx_status_history_estimate_created`, `idx_admin_memos_estimate_created` (all `IF NOT EXISTS`, dropped with `IF EXISTS`). No existing index duplicates these column combinations. They make `idx_estimates_status`, `idx_status_history_estimate_id` and `idx_admin_memos_estimate_id` largely redundant; those are left in place.
- `012_customer_type_and_privacy_consent.ts`: customer type and privacy consent columns (see "Customer type and privacy consent"). Rolling back is refused while a customer type or a consent exists.
- `013_align_estimate_statuses.ts`: the ten statuses of the PRD (see "Statuses of the PRD and migration 013"). Rolling back is refused while an estimate is in `info_requested` or `factory_checking`.
- `010_admin_memos_content_check.ts`: `CHECK (char_length(content) BETWEEN 1 AND 5000)` on `admin_memos.content` (see Admin memos).
- `011_admin_must_change_password.ts`: adds `admin_users.must_change_password` (`BOOLEAN NOT NULL DEFAULT false`) and flags the untouched seeded `master` account (see Admin account initialization). Rolling back drops the column, so the forced change is lost.

### Admin account initialization and forced password change

**Forced password change.** `admin_users.must_change_password` (`BOOLEAN NOT NULL DEFAULT false`, migration `011_admin_must_change_password.ts`) marks an account that has to change its password before doing anything else.
- After logging in, such an account can call only `PATCH /admin/me/password` and `POST /admin/logout`. Every other admin route (estimate list and detail, status change, memos, files, and any route added later) answers **403 `PASSWORD_CHANGE_REQUIRED`**. The check is in `authMiddleware` and is deny-by-default: a route is open to these accounts only if it explicitly uses `allowPasswordChangeRequired`.
- The login response contains `admin.must_change_password`, so a client can send the user to the password screen.
- A successful password change sets the flag to `false`, revokes every session and clears the cookies; after logging in again the whole admin API is available. Blocked requests are written to the audit log as `admin.access.blocked`.
- To force a change for any account: `UPDATE admin_users SET must_change_password = true WHERE username = '...';` (its open sessions are blocked on their next request).
- Migration 011 sets the flag to `true` only for the seeded `master` account (id `a0000000-0000-0000-0000-000000000001`) and only while it still carries the seed password hash from migration 005, so an account whose password was already changed is not flagged.

**The seeded `master` password is unknown (verified 2026-10-13).** Earlier documentation said the initial password is `CHANGE_ME_ON_FIRST_LOGIN`. The bcrypt hash that migration 005 actually inserts is a valid 60-character, 12-round hash, but it does **not** match that password (nor any common guess), so on a freshly migrated database nobody can log in as `master`. The forced-change flag therefore only becomes useful once an operator sets a password (below). The password policy also rejects `CHANGE_ME_ON_FIRST_LOGIN` as a new password. No default password is shipped on purpose: with a publicly known password, whoever called the password change first would own the admin account.

**Operational initialization policy (every environment, production above all).** Migration 005 creates `master` wherever migrations run, so every new database needs this procedure.
1. Do not expose the API to the internet before step 3 is done.
2. Run `npm run admin:bootstrap` (details below) from a trusted machine and enter a one-time password.
3. Log in as `master` with the one-time password and immediately change it (the first-login flow below). Until that succeeds every other admin route answers 403 `PASSWORD_CHANGE_REQUIRED`.
4. Create the real admin accounts (there is no API or command to create accounts yet: insert rows with a bcrypt hash and `must_change_password = true`, then initialize them with `admin:bootstrap`) and deactivate `master` (`is_active = false`) unless it is the only admin.
5. Rolling back migration 011, or restoring a database dump from before it, removes the forced change: repeat the procedure.

### `npm run admin:bootstrap`

Sets the one-time password of an existing admin account that still has `must_change_password = true` (the seeded `master` after migration 011). Code: `src/scripts/bootstrap-admin.ts` (entry, compiled to `dist/scripts/bootstrap-admin.js`), `scripts/admin-bootstrap.js` (plain-JavaScript launcher), `src/cli/bootstrapAdminCli.ts` (flow), `src/services/adminBootstrapService.ts` (database work).

```bash
npm run build                                             # once, and again after every code update
DATABASE_URL="postgres://..." npm run admin:bootstrap     # or put DATABASE_URL in .env
```

- **Needs** `DATABASE_URL` (the web server's other settings such as `JWT_SECRET` are not needed), an interactive terminal, and a build (`npm run build`). It runs the **compiled** `dist/scripts/bootstrap-admin.js` with plain Node (`node dist/scripts/bootstrap-admin.js` works too), so it needs neither `ts-node` nor TypeScript nor any dev dependency and runs on an install that only has the production dependencies. It uses the last build, so rebuild after updating the code. A one-off process that has a terminal (for example `heroku run npm run admin:bootstrap`) can run it; that was not tested here. For a managed Postgres that requires TLS use `?sslmode=require` in the URL or set `PGSSLMODE=require`.
- **If `dist/scripts/bootstrap-admin.js` does not exist**, `npm run admin:bootstrap` tells you to run `npm run build` first and stops with exit code 1 without doing anything (it never prints environment values).
- **Without `DATABASE_URL`, or without a terminal, it aborts** before asking anything and changes nothing. The password is never read from arguments, files or the environment.
- **Prompts:** the admin username (visible), then the one-time password and its confirmation, both typed **without echo**. Up to 3 attempts if the entries differ or the password is rejected.
- **Password rules** are the same as `PATCH /admin/me/password` (`src/utils/passwordPolicy.ts`): at least **12 characters** (code points), at most **72 bytes** in UTF-8 (never truncated), at least 3 of 4 character types, not the username/email/default password. Hashing uses bcrypt with 12 rounds.
- **Which accounts:** only an existing, active account with `must_change_password = true`. An account that already changed its password (`must_change_password = false`) is **not overwritten**: the command stops with a message. Unknown and deactivated accounts are refused too. There is no option to override this.
- **What it writes**, in one transaction with the account row locked (`SELECT ... FOR UPDATE`; the checks are repeated under the lock): `password_hash`, `must_change_password = true`, `failed_login_attempts = 0`, `locked_until = NULL`, `updated_at`. It also revokes the account's open sessions, because the earlier password is no longer trusted.
- **Output:** the password, its hash and `DATABASE_URL` are never printed or logged. Database errors show only a short error code. On success it prints one line: `Bootstrap completed for admin "<username>".`

**First login after the bootstrap** (the one-time password must never become the real password):
1. `POST /admin/login` with the username and the one-time password succeeds, and the response has `admin.must_change_password: true`.
2. Every admin route except the next two answers 403 `PASSWORD_CHANGE_REQUIRED`.
3. `PATCH /admin/me/password` with `current_password` = the one-time password and a `new_password` that follows the policy changes it. The flag becomes `false`, every session is revoked and the cookies are cleared.
4. Log in again with the new password: the whole admin API is available.
(`POST /admin/logout` also works while the change is pending.)

**Manual fallback** (only if the command cannot be used): create the bcrypt hash (cost 12) of a random one-time password of at most 72 bytes on a trusted machine, for example `node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "<one-time password>"` (a longer password would be silently cut by that tool; never commit, log or paste the password), then:
```sql
UPDATE admin_users
SET password_hash = '<hash>', must_change_password = true,
    failed_login_attempts = 0, locked_until = NULL, is_active = true
WHERE username = 'master';
```

### Dependency security audit (2026-10-13)

`npm audit --omit=dev` (production dependencies) before and after:

| | Before | After |
|---|---|---|
| high | 3 (`axios` 0.26.1, `@sendgrid/client` 7.7.0, `@sendgrid/mail` 7.7.0; axios came in through the SendGrid client) | 0 |
| moderate | 1 (`uuid` 9.0.1, a direct dependency) | 0 |
| **total** | **4** | **0** |

What changed (no `npm audit fix`, no forced upgrades):
- `@sendgrid/mail` `^7.7.0` -> `^8.1.6`. It is a CommonJS package (like 7.x), so the TypeScript CommonJS build and `require('@sendgrid/mail')` in `emailWorker.ts` keep working. It pulls `@sendgrid/client` 8.1.6 and `axios` 1.20.0, which closes all three high findings.
- `uuid` and `@types/uuid` are **removed**; the two places that used `uuid.v4()` (admin session ids in `adminAuth.ts`, file ids in `fileValidation.ts`) now use Node's built-in `crypto.randomUUID()`, which also returns a version 4 UUID. Upgrading `uuid` was not an option: the fixed version 14 is ESM-only (`"type": "module"`, no CommonJS entry), which does not work with this project's CommonJS build and with `require()` on Node 18/20. Replacing it also removes a dependency.

How compatibility was checked (no real SendGrid call):
- `npm run build` and the whole test suite pass.
- `src/__tests__/sendgridCompatibility.test.ts` runs our `sendEmailViaSendGrid` against the installed library with a stub HTTP server on `127.0.0.1`: request path and method, `Authorization` header, recipient/sender/subject/HTML body (including Korean text), click and open tracking switched off, `x-message-id` extraction, the missing-message-id case, 400/401/403/429/500 answers (errors never contain the API key), and the not-configured case.
- Note for anyone testing this: `setApiKey()` resets the client's base URL to the real SendGrid host, so a stub address must be applied after it. The test does this and also refuses any non-local HTTP request.
- `jest.setup.js` makes every test file refuse connections to any host other than this machine: http/https requests, raw TCP/TLS sockets (so a PostgreSQL driver cannot connect either) and the global `fetch`. A blocked call fails with `External ... blocked in tests: <host>` (the host only, never a URL or credentials) before any lookup or connection, so a test can never reach SendGrid, AWS, a database or any other real service. `src/__tests__/networkGuard.test.ts` checks this using only unresolvable `.invalid` host names, and refuses to run if the guard is not installed.
- **Not verified:** real delivery through SendGrid (no API key, never tested), so check an actual send before relying on version 8 in production. The error mapping in `sendEmailViaSendGrid` looks for the texts "Invalid email" and "Authentication failed"; SendGrid answers such as 401 "Unauthorized" fall into the generic `SendGrid API error: ...` branch.

**Audit status (Phase 3 Week 3)** - production and development dependencies are audited separately:

| Command | What it checks | Result |
|---|---|---|
| `npm run audit:prod` (`npm audit --omit=dev`) | Packages installed in production | **0 vulnerabilities** |
| `npm run audit:dev` (`npm audit --audit-level=high`) | Everything including dev tools; fails on high/critical only | passes; 20 **moderate** findings accepted |

- The one critical development finding (`handlebars` 4.7.9, used only by `ts-jest`) was fixed by updating to 4.7.10 inside its allowed range.
- The 20 accepted moderate findings are `sprintf-js` (denial of service through precision specifiers) and the packages that depend on it (`argparse`, `js-yaml`, ... via the jest/ts-jest coverage tooling). The only fix npm offers is a breaking downgrade of `ts-jest`, which was not applied. They exist only on machines that install dev dependencies and never process untrusted input. Details and the review plan are in [docs/SECURITY.md](docs/SECURITY.md).
- CI runs both audits (`.github/workflows/ci.yml`).

### Required before public launch (not implemented in Phase 3)

- **Approve the privacy consent text** and register its version (`APPROVED_CONSENT_VERSIONS` in `src/config/privacyConsent.ts`, text in `docs/privacy-consent/<version>.md`). The customer type and the consent are stored and shown to admins (PRD FR-4.2, FR-5.2, FR-5.3), but production answers every estimate request with 503 until a version is approved. The wording needs legal and operational review and has not been written. The front end still has to collect the customer type, the name and the consent (Phase 4).
- Formal quotation file attachment (PRD FR-5.7) and a record of whether the quotation was sent to the customer (FR-5.8).
- ClamAV scanning and enabling admin file downloads (FR-5.4). Downloads are **intentionally blocked** in Phase 3 until scanning exists.
- Customer-facing status emails (`status_update`).
- Send a real test email through SendGrid 8.x (only verified against a local stub so far), and review the accepted development-dependency findings when the jest toolchain is updated.
- Creating new admin accounts: `admin:bootstrap` only initializes an existing account that is still flagged `must_change_password`; there is no command or API that creates an account.
- A shared (for example Redis) store for the admin and public limiters before running more than one instance (the public customer API now has per-IP limits, but only in process memory).
- Durable audit logs: detail views, memo access and blocked file attempts exist only in the application log, which Heroku does not keep.
- Resetting another admin's password (admin-initiated reset); today an admin can only change their own.

## Price guidance: POST /api/estimate-preview (sunglasses)

A rule-based price range for a sunglasses request (PRD FR-3, option A). It stores nothing, takes no personal data and needs no consent or token. The answer is guidance, never a quote: every response carries a `notice` that says so, and the 8% service fee is not part of it.

Request (JSON): `{ "category": "sunglasses", "material": "plastic", "lens_type": "normal", "quantity": 500 }`

- `category`: any eyewear category (`sunglasses`, `optical`, `sports`, `kids`, `safety`, `eyewear`). Other categories get `200 { available: false, reason: "CATEGORY_NOT_SUPPORTED" }` so the front end can fall back to the plain request form.
- `material`: `plastic`, `metal`, `acetate`, `wood`, `mixed` or `unknown`. `lens_type`: `normal`, `polarized`, `mirror`, `gradient`, `photochromic` or `unknown`. `quantity`: integer, 1 to 1,000,000. Anything else is `400`.

Answer: `{ available: true, currency: "KRW", quantity, unit_price: { min, max }, total_price: { min, max }, notice }`, rounded to 100 won. `available: false` with `reason: "NO_BASE_PRICE"` means no active `eyewear` row exists in `base_prices`.

How the range is computed (`src/services/estimatePreviewService.ts`, rules in `src/config/sunglassesPricingRules.ts`):

1. Unit price = the active `base_prices` row for the material (`Plastic Frame`, `Metal Frame`, `Acetate Frame`, `Wood Frame`, `Mixed Frame`) x the lens multiplier x the quantity tier multiplier.
2. The range is the unit price -/+ 15%. Every unknown answer widens it by 10 points. A material that is `unknown`, or has no active row, is priced between the cheapest and the dearest active eyewear row.
3. Staff change the base prices in `base_prices`; the multipliers and tiers live in the rules file. **The multipliers are placeholders and the development base prices are `[SAMPLE]` data: replace both with real quote figures before showing the range to customers.**

### Photo analysis: POST /api/estimate-preview/analyze-image

The visitor's photo of the product goes in, and the frame material and lens type it shows come out, so the form can fill them in and start the price guidance. Multipart form with one field `image` (JPG, PNG or WEBP, up to 5 MB; the first bytes must match the type; the same types as the attachments, so the analysed photo can be attached to the request). The image is kept in memory only and sent to the Claude API; nothing is written to disk or S3, and the form tells the visitor the photo is sent to an AI service.

Answer: `{ analysis: { is_sunglasses, frame_material, lens_type, confidence, summary }, notice }`. `frame_material` and `lens_type` use the values of the preview request, or `unknown`. A photo cannot show polarization, so `lens_type` is `unknown` unless the image says so. Errors: `400` (no image, wrong type, bytes do not match), `413` (over 5 MB), `429` (rate limit), `502` (the model refused or answered something unusable), `503` (no `ANTHROPIC_API_KEY`).

The form (`estimate-preview.js`) fills a select only when the visitor has not chosen a value there, and never blocks the request form when the analysis fails. The service is `src/services/imageAnalysisService.ts`; the answer is checked against a JSON schema before it is used. **Not yet checked against the real API: the tests use a fake client.**

### Result screen of the sunglasses quote

Step 2 of `sunglasses-estimate.html` ends with **AI 견적 시작** (no longer a plain next button). When the product input is valid, `estimate-flow.js` calls `BridgePathResult.show()` (`estimate-result.js`) instead of going to step 3. The result screen has the same parts as the reference quote: the photo, 종합 분석 (with a complexity badge), 인식 결과 (frame material, lens type, shape, colour; the visitor edits them with **수정하기**, which goes back to step 2), 예상 비용 (unit price range, quantity, total budget range from `POST /api/estimate-preview`), and on the side 상세 분석, 주요 비용 요인 and 권고사항. **정식 견적 요청하기** goes on to step 3, where the request is sent as before.

- The analysis texts come from the photo analysis (`analyze-image` answers `frame_shape`, `frame_color`, `complexity`, `overview`, `details`, `cost_factors` and `recommendations` besides the material and the lens). Without a photo the screen shows the form values and the price only. The prompt forbids prices, countries and factories in those texts: the only prices on the screen are the range of the rules.
- The bridge width, arm length and lens width fields are gone from the form and from the specification (`bridge_width_mm`, `arm_length_mm`, `lens_width_mm` are no longer sent).
- The price range has no minimum order quantity and no domestic/overseas columns: there is no data for them yet.

### Base prices of sunglasses (migration 014)

`014_sunglasses_base_prices.ts` writes the first base prices (category `eyewear`) from China factory listings on Made-in-China.com read on 2026-10-20: for each material the median of the listings that pass the filters of `scripts/sunglasses-base-prices.js`, in USD, converted to KRW at 1 USD = 1,330.79 KRW (open.er-api.com, 2026-10-20). Alibaba.com was not used: it answers an automated browser with a slider verification, which is not bypassed.

| Variant | Listings used | Median USD | Base price KRW |
|---|---|---|---|
| Plastic Frame | 12 | 1.955 | 2,600 |
| Metal Frame | 14 | 3.9025 | 5,190 |
| Acetate Frame | 16 | 7.3725 | 9,810 |
| Wood Frame | 10 | 5.07 | 6,750 |
| Mixed Frame (acetate + metal) | 14 | 6.475 | 8,620 |

- The data and the sources are in `docs/pricing/sunglasses-factory-prices-2026-10-20.json`; `node scripts/sunglasses-base-prices.js` prints the table again (`--rate=` for another rate, `--json` for machine output). `migration014.test.ts` fails when the migration and the script disagree.
- A price is a factory price per piece as listed, at the middle of the listed range (FOB-style). It does **not** include shipping, duty, mold, logo, packaging or the service fee, and listings are mostly stock designs, not custom OEM development. It is an opening estimate: replace each row with the figures of real quotes as they come in, and keep the lens multipliers and quantity tiers (placeholders) in mind.
- The migration also switches off the other `[SAMPLE]` eyewear rows (`Premium Frame`), so an unknown material is priced between the cheapest and the dearest of these five. Nothing is applied by the tests: run `npm run db:migrate` yourself on a database you chose.

### All or nothing: files, storage and the receipt number (PRD FR-4.7)

A request with files is saved with all of them or not at all, so a failed attachment never leaves an estimate behind and trying again cannot make a second request:

1. The route checks the files (type by content, size, count, total) and answers **400** `File validation failed` with `details: [{ filename, errors }]` for anything wrong. What Multer refuses (a type that is not allowed, a file over 10 MB, a sixth file) is answered the same way; it used to reach the error handler as a 500.
2. `storeFiles()` (`services/fileService.ts`) puts every file in the storage under `estimates/<estimate id>/<file id>.<ext>`, with the estimate id chosen in advance. If one fails, the ones already stored are removed and the route answers **500** `FILE_UPLOAD_FAILED`: no estimate was created.
3. `createEstimate()` writes the estimate, its access token, the e-mail outbox rows **and the file rows** in one transaction. If it fails, the route removes the stored files (`discardStoredFiles`).
4. Only then the customer gets **201** with the receipt number and the files (`id`, `filename`, `size`, `status`; never the key).

- **Storage** (`services/fileStorage.ts`): `FILE_STORAGE=s3` (default) or `FILE_STORAGE=local`, a folder (`LOCAL_UPLOAD_DIR`, default `uploads-dev`, in `.gitignore`) for development and tests without AWS. `local` is refused when `NODE_ENV=production`. The local storage accepts only keys of the exact server-made form and never writes a key twice. **S3 itself has still not been tried against real AWS.**
- **File names**: Multer reads a name as Latin-1, so a Korean name arrived as mojibake; `decodeFilename` gives it back. The original name is kept for display only (`displayFilename`: no folders, control characters or `<>"'`` ), never in a key or path. A client that shows it must still escape it.
- Files are stored as `quarantine` / virus scan `pending`; nothing approves them yet, so **admin downloads stay blocked** (unchanged).

### The AI screen record (`ai_preview`)

A sunglasses request may carry `specification_json.ai_preview`: what the customer's screen showed when the AI quote was started: `{ source: "customer_screen", analysis: { frame_material, lens_type, confidence, complexity, frame_shape, frame_color, overview, details: { frame, lens, decoration }, cost_factors[], recommendations[] }, price: { currency: "KRW", quantity, unit_price: { min, max }, total_price: { min, max } } }` (`utils/specification.ts`). It is written by the browser, so it is **a record of what the customer saw, never a quote and never trusted**: staff work from the real specification and the pricing rules. It is advisory, so a record that does not fit this shape is dropped (a warning is logged) and the request goes on.

### Attachments on the estimate pages (front end)

All four pages (`sunglasses`, `shoes`, `golf`, `other-inquiry`) have a block `<div id="attachments">`, filled by `estimate-attachments.js` (PRD FR-2): a file chooser (also drag and drop) for JPG, PNG, WEBP and PDF, 10 MB a file, 5 files, 30 MB together, the list with name, size and a **delete** button for each file, a mark on a file of the same name and size, and a message by file for what is refused. The checks are those of `estimate-api.js` (`FILE_POLICY`, `validateFiles`); the API checks everything again by content.

- With files the request is a multipart form, without them JSON (`buildRequest` in `estimate-api.js`). `estimate-submit.js` takes the files from the component (`getFiles`) and empties it after an accepted request (`afterSuccess`).
- **Sunglasses**: the photo that is put in the AI box is attached as soon as it is ready, whatever the analysis says, and marked "AI 분석에 쓴 사진". The customer can take it out of the list. The form says that the photo goes to an AI service and is attached to the request.
- The request carries `specification_json.ai_preview` when the result screen was shown: what the customer saw (see "The AI screen record"). The browser cuts the texts to the limits of the API so the record is not lost to a long sentence; `estimateAttachedRequest.dom.test.ts` checks that the record is one the API accepts.
- **Failures** (PRD FR-4.7): a 5xx answer means nothing was saved (the API is all or nothing), so the page says "접수되지 않았어요" and keeps the form and the files; only a timeout or a lost connection may have been saved, and says so. What the API refuses about a file (400) is shown by file name.
- The analysis and the attachments take the same types (JPG, PNG, WEBP); GIF is no longer accepted by either.

### The receipt after an accepted request (PRD FR-4.5)

The success screen of the four pages shows the receipt number (with a **copy** button: it uses the browser's clipboard and otherwise asks the customer to copy by hand; nothing is stored), the time, the fixed message of the API, and **what was sent**: the kind and the values of the product, the price range that the AI screen showed (marked as a reference, not a quote), the contact details as typed, and the names of the attached files. What was not filled in is not listed. `estimate-submit.js` builds the rows before the form is emptied (`getSummary` of the page for the product); every value is put in with `textContent`. The screen promises no answer time and no e-mail (PRD FR-4.9; the e-mail sending has not been tried against SendGrid).

### The admin screen (`admin-ui/`, PRD FR-5)

A screen for the staff, served by the backend itself at **`/admin-ui/`** (static files of `admin-ui/`). Same origin on purpose: the admin cookies are `HttpOnly` and `SameSite=Strict`, so a screen on another site could not sign in. Plain HTML, CSS and JS, no build step: `admin-labels.js` (the words), `admin-api.js` (the calls), `admin-app.js` (the screens).

- **What it does (first version)**: sign in and out; the forced change of the password at the first sign-in (`must_change_password`) and by choice; a session that expires is refreshed once (`POST /admin/token/refresh`) and the request sent again, otherwise the login comes with a message; the **list** of requests (status, product, search by number, name, company, e-mail or phone, dates, sort, 20 per page, the customer type, the number of files); one **request** with the customer and the consent, the specification in Korean, the record of the customer screen (`ai_preview`, shown apart and said not to be a quote), the file metadata, the status history and the memos; the **change of the status** (only what the API allows, a reason where it is required, the status that was on the screen is sent as `expected_status` so that a change by a colleague is noticed); **memos**.
- **Backend additions**: `GET /admin/me` (who is signed in, also for an account that must change its password); `allowed_transitions` in the detail (`[{ to, reason_required }]`, for this admin's role, from `utils/statusTransitions.ts`, so the screen does not carry the rules); `/admin-ui/` is served with `Cache-Control: no-store`, `X-Robots-Tag: noindex` and the default helmet `Content-Security-Policy` (scripts only from the same origin), so the screen uses no inline script or handler.
- **Safe by construction**: everything that comes from the server, and so from a customer or a colleague (a name, a file name, the specification, a memo), is put in with `textContent`; no `innerHTML`. The session is the cookies of the server: no token in the page, nothing in the browser's storage. `adminUiStructure.test.ts` checks these rules in the source.
- **Not in this version**: attaching the formal quote file (PRD FR-5.7: needs an admin upload and a kind of file), opening or downloading customer files (FR-5.4: blocked until virus scanning exists, the screen says so), statistics, deleting, several permission levels (PRD: not in the MVP).
- **Try it**: start the backend (`npm run dev`, with `DATABASE_URL` and an admin account, see "Admin account initialization") and open `http://localhost:4000/admin-ui/`. The unit tests run the screen in jsdom against a fake of the API.
- **Deploy**: nothing to configure for the screen itself; it is part of the backend. With `COOKIE_SECURE=true` (required in production) the site must be served over HTTPS.

### Customer accounts (the detailed quote from a staff member is for signed-in customers)

Step 1 of the staff detailed quote: **sign-up and login**. The AI quote and the simple estimate request stay open to everyone; only the staff's detailed quote (next steps) will need an account.

- **Page**: `login.html` (+ `customer-auth.js` for checks, texts and calls, `customer-auth-page.js` for the steps, `customer-auth.css`): login, sign-up, the 6-box e-mail code, password reset, and the consent step for Google/Kakao customers. Linked from the home page. After a sign-in the browser goes on to `?next=` (a page of this site only; anything else becomes `/`).
- **Sign-up** (`POST /api/customers/signup`): e-mail, password (8+ characters with a letter and a digit, at most 72 bytes), name, optional phone, company and customer type, and the privacy consent with an accepted version (same list as the estimate request; production answers 503 until a version is approved). The account stays **unverified** until `POST /api/customers/verify-email` with the 6-digit code, which also signs the customer in. The code is valid 10 minutes, 5 wrong tries delete it, a new one only once a minute (`POST /api/customers/resend-code`, which answers the same for every e-mail so it does not reveal who has an account). A new sign-up for an e-mail that nobody has verified takes it over; a verified one answers 409 `EMAIL_TAKEN` (this does tell that the e-mail has an account, as most sign-up pages do).
- **Login** (`POST /api/customers/login`): lowercase e-mail, 5 wrong passwords lock the account for 15 minutes (same rule as the admin), a login for an unknown e-mail costs the same time as a known one, an unverified e-mail answers 403 `EMAIL_NOT_VERIFIED` (only after the password was right) and mails a fresh code.
- **Session**: the cookie `bp_session` holds a random 32-byte token, the table `customer_sessions` only its SHA-256, 30 days, revocable (`POST /api/customers/logout`; a password reset ends all sessions). `HttpOnly`, `Secure` with `COOKIE_SECURE`, **`SameSite=Lax`** (a link from an e-mail or from Google/Kakao must arrive signed in; Lax cookies are not sent on cross-site POSTs, so the JSON API is safe from forged requests), path `/api`. Fetches from the pages use `credentials: 'include'`. **The pages and the API must be the same *site*** (for example `www.example.com` and `api.example.com`, or one host); different sites would not get the cookie. This is separate from the admin session (`access_token`, path `/admin`): neither works as the other.
- **Other endpoints**: `GET /api/customers/me` (401 when signed out), `PATCH /me` (name, phone, company, type), `POST /me/consent`, `POST /password-reset/request` and `/confirm` (code from the e-mail, ends all sessions, works for a Google-only account too), `GET /oauth/providers`.
- **Google and Kakao** (`GET /api/customers/oauth/<google|kakao>/start`, `.../callback`): authorization code flow on the server, state in a signed 10-minute cookie, PKCE for Google, only an e-mail that the provider says is **verified** is accepted (Kakao: `account_email` needs the business-app review). A known provider id signs in; the same e-mail as an existing account links the provider to it (an unverified password sign-up for that e-mail loses its password: its owner never proved the address); otherwise a verified account without a password is made, and the customer is asked for the consent before going on. Errors come back to `login.html?error=<fixed code>` (never a text from the provider). Naver is not offered. **Needs setting up outside the code**: a Google OAuth client and a Kakao app, each with the redirect address `<PUBLIC_API_URL>/api/customers/oauth/<provider>/callback`, and the ids in the environment (see the table); without them the buttons stay hidden.
- **E-mail**: the codes are sent at once through SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`), not through the outbox (a code that arrives after a retry is useless, and it must not stay in a table of sent mails). Without SendGrid, **development** prints the code to the server's console; production answers 503 `EMAIL_UNAVAILABLE`.
- **Migration 015**: `customers`, `customer_identities`, `customer_sessions`, `customer_email_codes` (codes are stored as a keyed hash bound to the account and purpose).
- **Not in step 1**: the detailed quote itself (done in step 2 below only as far as the request, the admin form and "my quotes" for the customer are next), account deletion, changing the e-mail, the cleanup of expired sessions and codes.

#### Step 2: asking for a detailed quote from the AI quote result (sunglasses page)

- **Result screen**: under "정식 견적 요청하기" (the simple request, open to everyone, unchanged) there is a card with **"담당자 상세견적 받으러 가기"**, which says that the detailed quote can take about 2-3 working days (the wording is "걸릴 수 있어요", not a promise) and that it is for signed-in customers only.
- **Signed in**: the button goes to step 3, which now says it is a detailed quote request, is filled from the account (name, e-mail, phone, company, customer type), and sends the request as `request_kind: "detailed"` with the session cookie (`credentials: 'include'`; a simple request still sends none). The consent is still the customer's to tick.
- **Not signed in**: the card shows links to the login and sign-up pages that open in a **new tab** (`target=_blank rel=noopener`, `next=/login-complete.html`), so the form, the photo and the result stay as they are on this tab; when the customer comes back to this tab (focus / visibility) the sign-in is noticed (`GET /api/customers/me`) and the request goes on by itself. Nothing is stored in the browser.
- **API** (`POST /api/estimates`): the session is read after the body is parsed. A valid session links the request to the account (`estimates.customer_id`, migration 016) whatever its kind; `request_kind` is `simple` (default) or `detailed`; **a detailed request without a valid session is refused with 401 `CUSTOMER_AUTH_REQUIRED` before anything is stored** (no file reaches the storage, no receipt number is taken); any other value is 400. The customer id is never taken from the body. A request survives the deletion of the account (`ON DELETE SET NULL`).
- **Admin screen**: the list shows a "상세견적" tag next to the receipt number of a detailed request, and the detail says "요청 종류" and whether the customer has an account (`request_kind`, `has_account`; the customer id itself is not sent).
- **Not yet**: the staff's detailed quote itself (an admin form and a table for it), and the customer's "my quotes" page that shows it. Only the sunglasses page has the AI result screen, so only it has the button; shoes and golf have no AI quote yet.
