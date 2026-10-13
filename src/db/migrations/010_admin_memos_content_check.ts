import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Phase 3 Week 2: the memo API accepts 1-5000 characters (after trimming);
    -- this CHECK gives the database the same limit.
    -- Applying it fails if admin_memos already contains an empty or longer-than-5000
    -- character memo. No memo API existed before this phase, so none is expected.

    ALTER TABLE admin_memos DROP CONSTRAINT IF EXISTS admin_memos_content_length;

    ALTER TABLE admin_memos ADD CONSTRAINT admin_memos_content_length
      CHECK (char_length(content) BETWEEN 1 AND 5000);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Safe to roll back: it only removes the length limit.
    ALTER TABLE admin_memos DROP CONSTRAINT IF EXISTS admin_memos_content_length;
  `);
}
