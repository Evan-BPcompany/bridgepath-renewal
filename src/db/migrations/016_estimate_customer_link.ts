import type { Knex } from 'knex';

// A request can belong to a signed-in customer, and can be a "detailed quote" request (the staff
// write a detailed quote for it) instead of the simple request that anyone can send.
//   estimates.customer_id   the account that sent it; NULL for a guest. Kept (set NULL) if the account goes.
//                           That a detailed request has an account is checked by the API, not here: the
//                           request has to survive the deletion of the account.
//   estimates.request_kind  'simple' (the default, every request so far) or 'detailed'
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE estimates
      ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      ADD COLUMN request_kind VARCHAR(20) NOT NULL DEFAULT 'simple'
        CHECK (request_kind IN ('simple', 'detailed'));
    CREATE INDEX idx_estimates_customer ON estimates(customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_estimates_customer;
    ALTER TABLE estimates DROP COLUMN IF EXISTS request_kind, DROP COLUMN IF EXISTS customer_id;
  `);
}
