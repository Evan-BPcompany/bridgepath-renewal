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
All migrations are written in TypeScript with up/down functions:
```
src/db/migrations/
├── 001_init_schema.ts         (Core 7 tables)
├── 002_admin_sessions.ts      (Session management)
├── 003_estimate_access_tokens.ts (Access tokens)
├── 004_base_prices_and_email.ts  (Pricing + email events = 3 tables)
└── 005_seed_dev_data.ts       (Development data only)
```
**Total: 10 tables created** (admin_users, admin_sessions, estimates, estimate_access_tokens, files, base_prices, quotations, status_history, admin_memos, email_events)

**Run migrations**:
```bash
npm run db:migrate
```

**Rollback migrations** (reverts last migration):
```bash
npm run db:rollback
```

**Manual setup script** (alternative with validation):
```bash
bash scripts/setup-db.sh
```

**Verify database** (after running migrations):
```bash
# Connect to the database
psql $DATABASE_URL

# List all tables
\dt

# Check admin user (should show 'master' user)
SELECT username, email, role FROM admin_users WHERE username = 'master';

# Check table count (should show 10 tables)
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

# Check sample base prices (marked with [SAMPLE])
SELECT category, product_variant, description FROM base_prices WHERE description LIKE '[SAMPLE]%' LIMIT 5;
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
- [x] Day 2: PostgreSQL migrations and schema (9 tables, 5 migrations)
- [ ] Day 3: JWT authentication and session management
- [ ] Day 4: Receipt ID generation and session refresh tokens
- [ ] Day 5: Specification validation and error handling

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

**Last Updated**: 2026-09-30  
**Next Phase**: Database Migrations (Day 2)
