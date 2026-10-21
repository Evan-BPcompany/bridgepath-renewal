import type { Knex } from 'knex';

// The detailed quote that the staff write for a request of a signed-in customer (shown to that
// customer on "내 견적").
//   detailed_quotes           the working copy: one per request, edited by the staff, never seen by the customer
//   detailed_quote_revisions  every publication, as it was published (the customer sees the latest one)
// Only customer-facing fields are stored here; what the staff think stays in admin_memos.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE detailed_quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estimate_id UUID NOT NULL UNIQUE REFERENCES estimates(id) ON DELETE CASCADE,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
      fx_currency VARCHAR(3),
      fx_rate NUMERIC(14, 4),
      valid_until DATE,
      lead_time VARCHAR(200),
      customer_note TEXT,
      -- Number of the last publication; 0 = never published.
      version INT NOT NULL DEFAULT 0 CHECK (version >= 0),
      -- Counts the saves: a save has to name the one it was made from, so two staff members cannot
      -- overwrite each other without noticing.
      edit_seq INT NOT NULL DEFAULT 1 CHECK (edit_seq >= 1),
      has_unpublished_changes BOOLEAN NOT NULL DEFAULT true,
      created_by UUID REFERENCES admin_users(id),
      updated_by UUID REFERENCES admin_users(id),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMP WITH TIME ZONE,
      CONSTRAINT detailed_quotes_fx_pair CHECK ((fx_currency IS NULL) = (fx_rate IS NULL)),
      CONSTRAINT detailed_quotes_fx_rate_positive CHECK (fx_rate IS NULL OR fx_rate > 0)
    );

    CREATE TABLE detailed_quote_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES detailed_quotes(id) ON DELETE CASCADE,
      version INT NOT NULL CHECK (version >= 1),
      snapshot JSONB NOT NULL,
      published_by UUID REFERENCES admin_users(id),
      published_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (quote_id, version)
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS detailed_quote_revisions;
    DROP TABLE IF EXISTS detailed_quotes;
  `);
}
