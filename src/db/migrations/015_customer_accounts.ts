import type { Knex } from 'knex';

// Customer accounts (the detailed quote from a staff member is for signed-in customers only).
//   customers            the account; password_hash is NULL for an account that only uses Google/Kakao
//   customer_identities  one row per linked Google/Kakao account
//   customer_sessions    server-side sessions: the cookie holds a random token, the table its hash
//   customer_email_codes the 6-digit codes sent by e-mail (sign-up, password reset), stored as a hash
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255),
      name VARCHAR(100),
      phone VARCHAR(20),
      company_name VARCHAR(100),
      customer_type VARCHAR(30) CHECK (customer_type IN ('individual_startup', 'business_brand')),
      email_verified_at TIMESTAMP WITH TIME ZONE,
      privacy_consent_at TIMESTAMP WITH TIME ZONE,
      privacy_consent_version VARCHAR(50),
      is_active BOOLEAN NOT NULL DEFAULT true,
      failed_login_attempts INT NOT NULL DEFAULT 0,
      locked_until TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT customers_email_lowercase CHECK (email = lower(email))
    );
    CREATE UNIQUE INDEX idx_customers_email ON customers(email);

    CREATE TABLE customer_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      provider VARCHAR(20) NOT NULL CHECK (provider IN ('google', 'kakao')),
      provider_user_id VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (provider, provider_user_id),
      UNIQUE (customer_id, provider)
    );

    CREATE TABLE customer_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      user_agent VARCHAR(255),
      ip_address VARCHAR(64),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked_at TIMESTAMP WITH TIME ZONE
    );
    CREATE INDEX idx_customer_sessions_customer ON customer_sessions(customer_id);

    CREATE TABLE customer_email_codes (
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('signup', 'password_reset')),
      code_hash VARCHAR(64) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (customer_id, purpose)
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS customer_email_codes;
    DROP TABLE IF EXISTS customer_sessions;
    DROP TABLE IF EXISTS customer_identities;
    DROP TABLE IF EXISTS customers;
  `);
}
