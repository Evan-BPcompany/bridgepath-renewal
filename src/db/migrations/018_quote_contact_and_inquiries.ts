import type { Knex } from 'knex';

// 1. The staff member who answers for a detailed quote: name, e-mail and phone are written on the
//    quote and shown to the customer with it (and kept in each publication).
// 2. quote_inquiries: what a customer sends back about a published quote:
//      question      a short question (300 characters), answered by the staff in writing
//      consultation  a request for an in-depth talk: the staff phone the customer
//    One open question and one open consultation per request at most.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE detailed_quotes
      ADD COLUMN contact_name VARCHAR(50),
      ADD COLUMN contact_email VARCHAR(100),
      ADD COLUMN contact_phone VARCHAR(20);

    CREATE TABLE quote_inquiries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      -- The published version of the quote the customer was reading.
      quote_version INT NOT NULL CHECK (quote_version >= 1),
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('question', 'consultation')),
      -- The question; for a consultation an optional note about what to talk about.
      body VARCHAR(300),
      -- The number to phone (consultation only) and when it suits the customer.
      phone VARCHAR(20),
      preferred_time VARCHAR(20) CHECK (preferred_time IN ('any', 'weekday_am', 'weekday_pm')),
      status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'done')),
      -- The staff's written answer to a question, or a short note after the call.
      answer VARCHAR(500),
      handled_by UUID REFERENCES admin_users(id),
      handled_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT quote_inquiries_question_has_text CHECK (kind <> 'question' OR (body IS NOT NULL AND phone IS NULL)),
      CONSTRAINT quote_inquiries_consultation_has_phone CHECK (kind <> 'consultation' OR phone IS NOT NULL),
      CONSTRAINT quote_inquiries_status_fits_kind CHECK (
        status = 'open' OR (kind = 'question' AND status = 'answered' AND answer IS NOT NULL) OR (kind = 'consultation' AND status = 'done')
      ),
      CONSTRAINT quote_inquiries_handled CHECK ((status = 'open') = (handled_at IS NULL))
    );
    -- At most one open question and one open consultation per request.
    CREATE UNIQUE INDEX idx_quote_inquiries_one_open ON quote_inquiries(estimate_id, kind) WHERE status = 'open';
    CREATE INDEX idx_quote_inquiries_estimate ON quote_inquiries(estimate_id, created_at DESC);
    CREATE INDEX idx_quote_inquiries_open ON quote_inquiries(created_at) WHERE status = 'open';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE IF EXISTS quote_inquiries;
    ALTER TABLE detailed_quotes
      DROP COLUMN IF EXISTS contact_phone,
      DROP COLUMN IF EXISTS contact_email,
      DROP COLUMN IF EXISTS contact_name;
  `);
}
