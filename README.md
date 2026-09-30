# Bridge Path MVP

> Manufacturer OEM/ODM Quote Platform

## 🎯 Project Overview

Bridge Path is a platform that streamlines the quote request process for manufacturers and their customers. The MVP supports multiple product categories (eyewear, shoes, golf products, and other) with structured estimation workflows.

**Status**: Phase 1 - Backend Foundation (In Progress)

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
│   │       └── 005_seed_dev_data.ts
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
└── 006_receipt_sequence.ts         (1 table: receipt_sequence - infrastructure)
```

**Application Tables: 10**
- Core tables: 6 (001)
- Session management: 1 (002)
- Access tokens: 1 (003)
- Pricing & communication: 2 (004)

**Infrastructure Tables: 1**
- Receipt sequence: 1 (006)

**Knex Management Tables: 1 (auto-created)**
- knex_migrations: tracks migration state

**Total: 11 application + infrastructure tables**

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
- ✅ Migration structure verified (5 migration files, 10 tables)
- ⏳ Actual database migration: **NOT YET TESTED** (requires DATABASE_URL)

**Verify database** (only after migrations are executed with DATABASE_URL):
```bash
# Connect to the database
psql $DATABASE_URL

# List all tables (should show 10 tables)
\dt

# Verify master admin user was created
SELECT username, email, role FROM admin_users WHERE username = 'master';

# Verify all 10 tables exist
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
# Expected: 10

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

### Phase 1: Backend Foundation (5 days)
- [x] Day 1: Project structure initialization (Express, TypeScript, config)
- [x] Day 2: PostgreSQL migrations and schema (10 application + 1 infrastructure tables, 6 migration files)
- [x] Day 3: JWT authentication and session management
- [x] Day 4: Receipt ID generation and session refresh tokens
- [x] Day 5: Specification validation and error handling

### Phase 2: Customer API (7 days)
- [ ] Estimate submission endpoint
- [ ] File upload and validation
- [ ] S3 integration
- [ ] Email notifications

### Phase 3: Admin API (7 days)
- [ ] Admin dashboard endpoints
- [ ] Quotation management
- [ ] Status tracking and memos

### Phase 4: Frontend Integration (7 days)
- [ ] Connect existing HTML forms to API
- [ ] Fix known issues (script.js console errors)
- [ ] UI/UX improvements

### Phase 5: Testing & Deployment (7 days)
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
Request: { category, specification_json, customer_email?, ... }
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

All tests passing: ✅ 22/22

**Last Updated**: 2026-09-30  
**Next Phase**: Phase 2 - Customer API
