import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Contact policy (PRD FR-4.2): at least one of customer_email / customer_phone is required.
    -- Existing rows already have customer_email, so the new CHECK is satisfied by them
    -- unless a row holds a whitespace-only email and no phone.

    ALTER TABLE estimates ALTER COLUMN customer_email DROP NOT NULL;

    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_contact_required;

    ALTER TABLE estimates ADD CONSTRAINT estimates_contact_required CHECK (
      btrim(coalesce(customer_email, '')) <> ''
      OR btrim(coalesce(customer_phone, '')) <> ''
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_contact_required;

    -- Fails if rows with a NULL customer_email exist. Resolve those rows before rolling back.
    ALTER TABLE estimates ALTER COLUMN customer_email SET NOT NULL;
  `);
}
