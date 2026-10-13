# Bridge Path MVP

> Manufacturer OEM/ODM Quote Platform

## 🎯 Project Overview

Bridge Path is a platform that streamlines the quote request process for manufacturers and their customers. The MVP supports multiple product categories (eyewear, shoes, golf products, and other) with structured estimation workflows.

**Status**: Phase 3 Admin API Weeks 1-2 implemented, awaiting review (Phase 1 and Phase 2 Days 1-3 complete; Phase 2 Days 4-7 pending)

## 🔧 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | HTML5 / CSS3 / JavaScript | - |
| **Backend** | Node.js + Express + TypeScript | 18.x / 4.18.x / 5.0.x |
| **Database** | PostgreSQL | 14+ |
| **File Storage** | AWS S3 | - |
| **Email** | Sendgrid API | - |
| **Logging** | Winston + Sentry | 3.8.x / 7.50.x |

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
│   │       └── 011_admin_must_change_password.ts
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
- Node.js 18.x or higher
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
└── 011_admin_must_change_password.ts  (admin_users.must_change_password flag, no new table)
```

**Migration files: 11 (001-011)** - 008 to 011 were added in Phase 3 and create no tables

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

**Total: 10 application + 1 infrastructure tables (+ Knex-managed tables)**

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

Required variables for Day 1:
- `NODE_ENV` - Application environment (development/production/test)
- `PORT` - Server port (default: 4000)
- `CORS_ORIGINS` - Comma-separated list of allowed origins

Optional variables (added in later phases):
- `DATABASE_URL` - PostgreSQL connection string (Day 2)
- `JWT_SECRET` - JWT signing secret (Day 3)
- `AWS_*` - AWS credentials for S3 (Phase 2)
- `SENDGRID_API_KEY` - Email service API key (Phase 2)

See `.env.example` for all available variables.

## 🏗️ Development Phases

### Phase 1: Backend Foundation (5 days) - complete
- [x] Day 1: Project structure initialization (Express, TypeScript, config)
- [x] Day 2: PostgreSQL migrations and schema (10 application + 1 infrastructure tables, migration files 001-007 at that time)
- [x] Day 3: JWT authentication and session management
- [x] Day 4: Receipt ID generation and session refresh tokens
- [x] Day 5: Specification validation and error handling

### Phase 2: Customer API (7 days) - Days 1-3 complete
- [x] Day 1: Estimate submission endpoint (POST /api/estimates, GET /api/estimates/:receipt_id)
- [x] Day 2: File upload, validation, and S3 integration (multipart/form-data, magic bytes, compensation)
- [x] Day 3: Email notifications (SendGrid integration)
- [ ] Days 4-7: Additional features and testing (Day 4 stabilization/docs in progress)

### Phase 3: Admin API (7 days) - not started
- [ ] Admin dashboard endpoints
- [ ] Quotation management
- [ ] Status tracking and memos

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
- **File Validation**: MIME type, magic bytes, and ClamAV scanning
- **Email Safety**: Idempotency keys and retry logic

## 📞 Support

For questions or issues, please contact: contact@bridgepath.co.kr

---

## Phase 2 Day 1: Customer API (POST/GET estimates)

**Customer Quote Submission API**

Implemented secure customer quote submission and retrieval with:
- POST /api/estimates: Quote acceptance with validation and token generation
- GET /api/estimates/:receipt_id: Token-based retrieval with one-time use enforcement
- Atomic transaction: receipt_id generation, estimate saving, token creation in single SERIALIZABLE transaction
- Security: SHA-256 token hashing, one-time use, 7-day expiration

**API Contracts:**

```
POST /api/estimates
Request: { category, specification_json, customer_email?, customer_phone?, ... }  (at least one of customer_email / customer_phone required)
Response: { success, receipt_id, status, access_token, created_at }

GET /api/estimates/:receipt_id?token=xxx
Response: { receipt_id, category, status, specification_json, created_at, updated_at }
Error: { error: "Unauthorized", timestamp }
```

**Transaction Safety:**
- Single SERIALIZABLE transaction for receipt ID generation + estimate/token storage
- generateReceiptIdInTransaction() uses existing client (no nested transactions)
- Atomic token marking: UPDATE with WHERE conditions, no SELECT then UPDATE race condition

**Token Security:**
- Generation: 32-byte random token (client only), SHA-256 hash (DB only)
- One-time use: Atomic UPDATE with is_used=false AND expires_at>NOW() condition
- Expiration: 7 days (checked in UPDATE query, not SELECT then check)
- No token or email in logs

**Customer Response Privacy:**
- Returns: receipt_id, category, status, specification_json, timestamps
- Excludes: customer_name, customer_email, customer_phone, company_name
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
- Atomic transaction: Receipt ID generation + estimate storage + token creation in single SERIALIZABLE transaction

**Key Features:**
- **Receipt ID Generation**: Concurrent-safe with FOR UPDATE row-level locking and exponential backoff retry
- **Access Token Security**: SHA-256 hashing, one-time use, 7-day expiration
- **Customer Privacy**: Returns only receipt_id, category, status, specification_json (excludes customer PII)
- **Transaction Safety**: SERIALIZABLE isolation level prevents race conditions

**API Contracts:**

```
POST /api/estimates
Request:  { category, specification_json, customer_email?, customer_phone?, customer_name?, company_name? }  (at least one of customer_email / customer_phone required; 400 otherwise)
Response: { success: true, receipt_id, status, access_token, created_at }

GET /api/estimates/:receipt_id?token=xxx
Response: { receipt_id, category, status, specification_json, created_at, updated_at }
Error:    { error: "Unauthorized", timestamp }
```

**Test Coverage**: ✅ 26 tests

---

## Phase 2 Day 2: File Upload and S3 Integration

**Overview**

Implemented multipart/form-data file upload with private S3 storage, magic-byte validation, and comprehensive compensation handling for partial failures.

**File Upload Features:**

1. **Multipart/Form-Data Handling**
   - Accept multiple files (max 10 files per estimate)
   - Accept JSON specification_json as form field
   - Backward compatible with existing application/json API

2. **File Validation**
   - MIME type whitelist: JPEG, PNG, GIF, PDF
   - Magic bytes validation (prevent MIME type spoofing)
   - Extension validation (must match MIME type)
   - File size limit: 50MB per file
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
   - Estimate creation: SERIALIZABLE transaction, atomic commit
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
  status: "new_receipt",
  access_token: "...",
  created_at: "2026-09-30T...",
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
    { filename: "large.jpg", errors: ["File size exceeds 50MB limit"] }
  ],
  timestamp: "2026-09-30T..."
}

Response (file upload error):
HTTP 500: { error: "File upload failed", timestamp: "..." }
// Estimate created, but files may not have been stored
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
┌─ SERIALIZABLE Transaction ─────────────────┐
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
   - Estimate + email_events creation in single SERIALIZABLE transaction
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
- Rolling back migration 008 fails if any estimate has a NULL `customer_email`; resolve those rows first.

**Verification status**: covered by unit tests with a mocked database and by structural checks of the migration SQL. Migration 008 and the CHECK constraint have **not** been run against a real PostgreSQL (`DATABASE_URL` is not configured), so rollback behaviour is verified by reading the SQL only.

---

## Phase 3: Admin API (in progress)

**Plan**: 3 weeks.
- Week 1: estimate list/detail, auth and roles, status change.
- Week 2: memos, file metadata and blocked downloads, password change, login lockout fix, rate limiting (implemented; see the Week 2 sections below).
- Week 3: test hardening, integration test preparation, documentation, security review.

Actual ClamAV integration and enabling file downloads are **follow-up work** (see "Required before public launch").

**Verification status**: all Phase 3 tests so far use a mocked database (supertest + jest mocks). The SQL (row locking, filters, search, memo and password queries, migrations 008 to 011) has **not** been run against a real PostgreSQL because `DATABASE_URL` is not configured. Concurrency behaviour is verified only at the SQL-shape level until integration tests are run.
Phase 3 does not call AWS or SendGrid, and the real AWS/SendGrid integration tests from Phase 2 have also not been run because credentials are not configured.

### Admin endpoints (Week 1)

All routes live under `/admin/estimates`, use the existing HttpOnly cookie authentication, and are available to both `admin` and `manager`. `:id` is `estimates.id` (UUID), **not** the receipt id (`receipt_id` is a response field only).

| Method and path | Description |
|---|---|
| `GET /admin/estimates` | Paginated list. Query: `page` (default 1), `limit` (default 20, max 100), `status` (comma-separated), `category`, `created_from` / `created_to` (`YYYY-MM-DD`, Korea time, inclusive), `q` (search), `sort` (`created_at`, `updated_at`, `status`, `receipt_id`), `order` (`asc`/`desc`, default `desc`) |
| `GET /admin/estimates/:id` | Detail: estimate, file metadata, status history, memos |
| `PATCH /admin/estimates/:id/status` | Body `{ to_status, reason?, expected_status? }` |

- `q` matches the receipt id (prefix), company name, customer name, customer email (contains) and, when `q` looks like a phone number (4+ digits), the customer phone with formatting ignored. This supports the PRD FR-4.10 recovery path (finding a request from customer details).
- The list returns minimal personal data: `id`, `receipt_id`, `category`, `status`, `company_name`, `customer_name`, `created_at`, `updated_at`, `file_count`. Customer email, phone and `specification_json` appear only in the detail response.
- Never returned: customer access tokens or hashes, password hashes, refresh/access token hashes, `s3_key`, `virus_scan_result`.
- Responses: `{ success: true, data, pagination? }`. Errors: `{ error, code, timestamp }`.
- An account flagged `must_change_password` gets 403 `PASSWORD_CHANGE_REQUIRED` on every admin route except the password change and logout (see Admin account initialization).
- Mutating requests must use `Content-Type: application/json` (415 otherwise). Malformed JSON returns 400 `INVALID_JSON`.
- Audit logging: detail views and status changes (including denied attempts) are written to the application log as `admin_audit {...}` with only whitelisted fields (admin id, role, action, result, estimate id, statuses, IP). Memo text, reasons and email content are never logged. Detail views and denied attempts exist only in logs, which are not durable on Heroku; status changes are also stored permanently in `status_history`.
- The detail response includes at most the latest 200 status history entries and the latest 100 memos.
- Audit entries record the client IP from `req.ip`. Behind a proxy (Heroku) this is the proxy address until trust-proxy handling is added in Week 2.
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

Only the 10 values allowed by the `estimates.status` CHECK constraint are used. The table below is mirrored in `src/utils/statusTransitions.ts`; `statusTransitions.test.ts` fails if the two differ. `admin` may perform every listed transition; `manager` only those marked allowed.

<!-- STATUS_TRANSITIONS:START -->
| Current status | Next status | manager | admin | reason required |
|---|---|---|---|---|
| new_receipt | under_review | allowed | allowed | no |
| new_receipt | rejected | denied | allowed | yes |
| new_receipt | cancelled | denied | allowed | yes |
| under_review | quoted | allowed | allowed | no |
| under_review | on_hold | allowed | allowed | yes |
| under_review | rejected | denied | allowed | yes |
| under_review | cancelled | denied | allowed | yes |
| quoted | negotiating | allowed | allowed | no |
| quoted | accepted | allowed | allowed | no |
| quoted | on_hold | allowed | allowed | yes |
| quoted | rejected | denied | allowed | yes |
| quoted | cancelled | denied | allowed | yes |
| negotiating | quoted | allowed | allowed | no |
| negotiating | accepted | allowed | allowed | no |
| negotiating | on_hold | allowed | allowed | yes |
| negotiating | rejected | denied | allowed | yes |
| negotiating | cancelled | denied | allowed | yes |
| accepted | completed | allowed | allowed | yes |
| accepted | on_hold | allowed | allowed | yes |
| accepted | cancelled | denied | allowed | yes |
| on_hold | under_review | allowed | allowed | no |
| on_hold | cancelled | denied | allowed | yes |
| completed | archived | denied | allowed | no |
| rejected | archived | denied | allowed | no |
| cancelled | archived | denied | allowed | no |
<!-- STATUS_TRANSITIONS:END -->

`archived` is terminal (no outgoing transitions). Any pair not listed above is invalid.

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

**Database status values and PRD labels** (the PRD lists 10 statuses with different names):

| Database value | PRD label |
|---|---|
| new_receipt | 신규 접수 |
| under_review | 정보 확인 중 |
| quoted | 정식견적 발송 |
| negotiating | 고객 검토 중 |
| accepted | 진행 확정 |
| on_hold | 보류 |
| completed | 종결 |
| cancelled | 취소 |
| rejected | (not in PRD) |
| archived | (not in PRD) |

The PRD statuses `추가정보 요청` and `공장 견적 확인 중` have no database value yet. Until the status set is aligned with a new migration, use `under_review` together with an internal memo.

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
- **When a lock expires, `failed_login_attempts` and `locked_until` are reset** (the login writes the reset before checking the password). Previously the counter stayed at 5, so a single typo after the lock re-locked the account for another 15 minutes; now a lock needs 5 fresh failures.
- A successful login clears the counter and the lock.
- A failed attempt on the password change endpoint counts on the same counter.

### Rate limiting and TRUST_PROXY (Week 2)

Uses `express-rate-limit` with its default **in-memory store**. Exceeding a limit returns `429 { error, code: 'RATE_LIMITED', retry_after_seconds, timestamp }` with a `Retry-After` header and the standard `RateLimit-*` headers. Limiters run before the request body is parsed.

| Limiter | Applies to | Counted per | Counts | Variables | Default |
|---|---|---|---|---|---|
| login | `POST /admin/login` | client IP | **failed requests only** (status 400 and above); successful logins are not counted | `ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS` / `_MAX` | 15 min / 10 |
| admin API | everything under `/admin` (login and token refresh included, also unauthenticated requests) | client IP | every request | `ADMIN_API_RATE_LIMIT_WINDOW_MS` / `_MAX` | 1 min / 120 |
| mutation | status change and memo creation (`/admin/estimates/*`, non-GET) | signed-in admin | every non-GET request | `ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS` / `_MAX` | 1 min / 30 |
| password change | `PATCH /admin/me/password` | signed-in admin | every request | `ADMIN_PASSWORD_RATE_LIMIT_WINDOW_MS` / `_MAX` | 15 min / 5 |

- Window is 1000 ms to 24 h and max is 1 to 100000. A missing or empty variable uses the default; an invalid value stops the server at startup.
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
- **The public customer API (`POST /api/estimates`, `GET /api/estimates/:receipt_id`) has no rate limit**, so uploads, database writes and notification emails can be abused. Adding one is required before public launch.

In tests every `createApp()` creates its own limiters and counters, and `createApp({ rateLimits, trustProxy })` accepts small limits, so no test depends on real time or on another test.

### Migrations added in Phase 3

- `008_customer_contact_policy.ts`: contact policy (above).
- `009_admin_api_indexes.ts`: `idx_estimates_status_created_at`, `idx_status_history_estimate_created`, `idx_admin_memos_estimate_created` (all `IF NOT EXISTS`, dropped with `IF EXISTS`). No existing index duplicates these column combinations. They make `idx_estimates_status`, `idx_status_history_estimate_id` and `idx_admin_memos_estimate_id` largely redundant; those are left in place.
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

**Operational initialization policy (every environment, production above all).** Migration 005 creates `master` wherever migrations run.
1. Do not expose the API to the internet before step 4 is done.
2. Pick a random one-time password of at most 72 bytes (a longer one would be silently cut by the hashing tool). Create its bcrypt hash (cost 12) on a trusted machine, for example `node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "<one-time password>"`. Never commit, log or paste the password anywhere.
3. Store the hash and require a change:
   ```sql
   UPDATE admin_users
   SET password_hash = '<hash from step 2>', must_change_password = true,
       failed_login_attempts = 0, locked_until = NULL, is_active = true
   WHERE username = 'master';
   ```
4. Log in as `master` with the one-time password and immediately call `PATCH /admin/me/password` with a new password that follows the password policy. Until that succeeds every other admin route answers 403 `PASSWORD_CHANGE_REQUIRED`.
5. Create the real admin accounts (there is no API for this yet: insert rows with a bcrypt hash and `must_change_password = true`) and deactivate `master` (`is_active = false`) unless it is the only admin.
6. Rolling back migration 011, or restoring a database dump from before it, removes the forced change: repeat the steps above.

A scripted bootstrap command (no hand-written SQL) is follow-up work.

### Required before public launch (not implemented in Phase 3)

- Customer type ("개인·창업 준비 중" / "사업자·브랜드 운영 중") and personal-information consent are not stored. PRD FR-4.2, FR-5.2 and FR-5.3 require them (the admin list and detail must show the customer type).
- Formal quotation file attachment (PRD FR-5.7) and a record of whether the quotation was sent to the customer (FR-5.8).
- ClamAV scanning and enabling admin file downloads (FR-5.4). Downloads are **intentionally blocked** in Phase 3 until scanning exists.
- Customer-facing status emails (`status_update`).
- Align the status set with the PRD (`추가정보 요청`, `공장 견적 확인 중`).
- A scripted production admin bootstrap (today the initial password is set with a manual SQL step, see Admin account initialization).
- Rate limiting for the public customer API, and a shared (for example Redis) store for the admin limiters before running more than one instance.
- Durable audit logs: detail views, memo access and blocked file attempts exist only in the application log, which Heroku does not keep.
- Resetting another admin's password (admin-initiated reset); today an admin can only change their own.
