import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Phase 1 Day 2: Estimate access tokens for secure quote access

    CREATE TABLE IF NOT EXISTS estimate_access_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      receipt_id VARCHAR(50) NOT NULL REFERENCES estimates(receipt_id),
      token VARCHAR(255) NOT NULL UNIQUE,
      is_used BOOLEAN DEFAULT false,
      visited_at TIMESTAMP WITH TIME ZONE,
      visit_count INT DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days')
    );

    -- Create indexes for token access
    CREATE INDEX idx_estimate_access_tokens_estimate_id ON estimate_access_tokens(estimate_id);
    CREATE INDEX idx_estimate_access_tokens_receipt_id ON estimate_access_tokens(receipt_id);
    CREATE INDEX idx_estimate_access_tokens_token ON estimate_access_tokens(token);
    CREATE INDEX idx_estimate_access_tokens_is_used ON estimate_access_tokens(is_used);
    CREATE INDEX idx_estimate_access_tokens_expires_at ON estimate_access_tokens(expires_at);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_estimate_access_tokens_expires_at;
    DROP INDEX IF EXISTS idx_estimate_access_tokens_is_used;
    DROP INDEX IF EXISTS idx_estimate_access_tokens_token;
    DROP INDEX IF EXISTS idx_estimate_access_tokens_receipt_id;
    DROP INDEX IF EXISTS idx_estimate_access_tokens_estimate_id;

    DROP TABLE IF EXISTS estimate_access_tokens;
  `);
}
