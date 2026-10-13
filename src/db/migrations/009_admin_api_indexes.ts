import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Phase 3: indexes for admin list/detail queries.
    -- Existing single-column indexes (idx_estimates_status, idx_status_history_estimate_id,
    -- idx_admin_memos_estimate_id) are left untouched.

    CREATE INDEX IF NOT EXISTS idx_estimates_status_created_at
      ON estimates(status, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_status_history_estimate_created
      ON status_history(estimate_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_admin_memos_estimate_created
      ON admin_memos(estimate_id, created_at DESC);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_admin_memos_estimate_created;
    DROP INDEX IF EXISTS idx_status_history_estimate_created;
    DROP INDEX IF EXISTS idx_estimates_status_created_at;
  `);
}
