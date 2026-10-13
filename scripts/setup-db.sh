#!/bin/bash

# Bridge Path MVP - Database Setup Script
# This script initializes the PostgreSQL database with migrations

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_header() {
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}$1${NC}"
  echo -e "${GREEN}========================================${NC}"
}

print_error() {
  echo -e "${RED}✗ Error: $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
  echo -e "${YELLOW}ℹ $1${NC}"
}

# Check environment
check_env() {
  print_header "Checking Environment"

  # There is no default database: the target must be given explicitly.
  if [ -z "${DATABASE_URL:-}" ]; then
    print_error "DATABASE_URL is not set. Set it explicitly (there is no default database). Nothing was changed."
    exit 1
  fi

  # TEST_DATABASE_URL is reserved for automated tests and must never be the setup target.
  if [ -n "${TEST_DATABASE_URL:-}" ] && [ "$DATABASE_URL" = "$TEST_DATABASE_URL" ]; then
    print_error "DATABASE_URL and TEST_DATABASE_URL must not be the same. Nothing was changed."
    exit 1
  fi
  print_success "DATABASE_URL is set"

  if ! command -v psql &> /dev/null; then
    print_error "PostgreSQL client (psql) is not installed"
    exit 1
  fi
  print_success "PostgreSQL client found"

  if ! command -v npx &> /dev/null; then
    print_error "npm/npx is not installed"
    exit 1
  fi
  print_success "npm/npx found"
}

# Run migrations
run_migrations() {
  print_header "Running Database Migrations"

  if [ ! -f "knexfile.ts" ]; then
    print_error "knexfile.ts not found in project root"
    exit 1
  fi

  print_info "Executing migrations from src/db/migrations/"
  npx knex migrate:latest --env development

  if [ $? -eq 0 ]; then
    print_success "All migrations executed successfully"
  else
    print_error "Migration execution failed"
    exit 1
  fi
}

# Verify tables
verify_tables() {
  print_header "Verifying Database Schema"

  # List of expected tables
  TABLES=(
    "admin_users"
    "admin_sessions"
    "estimates"
    "estimate_access_tokens"
    "base_prices"
    "files"
    "quotations"
    "status_history"
    "admin_memos"
    "email_events"
  )

  missing_tables=()

  for table in "${TABLES[@]}"; do
    if psql "$DATABASE_URL" -tc "SELECT 1 FROM information_schema.tables WHERE table_name='$table'" | grep -q 1; then
      print_success "Table '$table' created"
    else
      print_error "Table '$table' not found"
      missing_tables+=("$table")
    fi
  done

  if [ ${#missing_tables[@]} -eq 0 ]; then
    print_success "All required tables exist"
  else
    print_error "Missing tables: ${missing_tables[*]}"
    exit 1
  fi
}

# Verify admin user
verify_admin_user() {
  print_header "Verifying Admin User"

  admin_count=$(psql "$DATABASE_URL" -tc "SELECT COUNT(*) FROM admin_users WHERE username='master'")

  if [ "$admin_count" -gt 0 ]; then
    print_success "Master admin user created"
    print_warning "The seeded master account has no usable password."
    print_warning "Run 'npm run admin:bootstrap' to set a one-time password that must be changed at the first login."
  else
    print_error "Master admin user not found"
    exit 1
  fi
}

# Main execution
main() {
  echo ""
  print_header "Bridge Path MVP - Database Setup"
  echo ""

  check_env
  run_migrations
  verify_tables
  verify_admin_user

  echo ""
  print_success "Database setup completed successfully!"
  echo ""
  print_info "Next steps:"
  echo "  1. Initialize the master admin with: npm run build && npm run admin:bootstrap"
  echo "  2. Update base prices as needed"
  echo "  3. Start the application with: npm run dev"
  echo ""
}

# Run main function
main
