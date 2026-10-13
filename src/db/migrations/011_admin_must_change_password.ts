import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- An account with must_change_password = true may only change its password and log out
    -- until it has done so (enforced by authMiddleware).

    ALTER TABLE admin_users
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

    -- The seeded account from migration 005 must change its password on first use.
    -- Only while it still has the seed hash, so a password that was already changed
    -- is not flagged again.
    UPDATE admin_users
    SET must_change_password = true
    WHERE id = 'a0000000-0000-0000-0000-000000000001'::uuid
      AND username = 'master'
      AND password_hash = '$2b$12$V9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jKMm.';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Drops the flag; accounts that were forced to change their password lose that requirement.
    ALTER TABLE admin_users DROP COLUMN IF EXISTS must_change_password;
  `);
}
