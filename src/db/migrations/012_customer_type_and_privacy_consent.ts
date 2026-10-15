import type { Knex } from 'knex';

// Customer type and privacy consent (PRD FR-4.2, FR-5.2, FR-5.3).
//
//   customer_type            'individual_startup' | 'business_brand'
//   privacy_consent_at       when the customer consented, set by the server (database time)
//   privacy_consent_version  identifier of the consent text the customer saw
//
// Existing rows keep NULL in all three columns: there is no record of a consent for them and
// none is invented. The columns are nullable on purpose and there is no default. Whether a new
// request must carry them is decided by the API, not by the database: a NOT VALID check would
// also reject every later UPDATE of an old row (a status change, for example).

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE estimates
      ADD COLUMN IF NOT EXISTS customer_type VARCHAR(30),
      ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS privacy_consent_version VARCHAR(50);

    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_customer_type_check;
    ALTER TABLE estimates ADD CONSTRAINT estimates_customer_type_check CHECK (
      customer_type IS NULL OR customer_type IN ('individual_startup', 'business_brand')
    );

    -- A consent is a time together with the version of the text, or nothing at all.
    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_privacy_consent_consistent;
    ALTER TABLE estimates ADD CONSTRAINT estimates_privacy_consent_consistent CHECK (
      (privacy_consent_at IS NULL) = (privacy_consent_version IS NULL)
      AND (privacy_consent_version IS NULL OR btrim(privacy_consent_version) <> '')
    );
  `);
}

// Rolling back drops the columns, which would destroy the consent records. It is therefore
// refused while any estimate holds a customer type or a consent. The table is locked first
// (writers wait, readers do not), so a request cannot slip a record in between the check and
// the drop. The whole migration runs in one transaction: a refusal changes nothing.
export async function down(knex: Knex): Promise<void> {
  await knex.raw('LOCK TABLE estimates IN SHARE ROW EXCLUSIVE MODE');

  const result = await knex.raw(`
    SELECT count(*)::int AS records
    FROM estimates
    WHERE customer_type IS NOT NULL
       OR privacy_consent_at IS NOT NULL
       OR privacy_consent_version IS NOT NULL
  `);
  const records: number = result.rows[0].records;

  if (records > 0) {
    throw new Error(
      `Refusing to roll back migration 012: ${records} estimate(s) hold a customer type or a ` +
        'privacy consent record, and dropping the columns would destroy them. Export or ' +
        'deliberately clear those values first, then roll back again.'
    );
  }

  await knex.raw(`
    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_privacy_consent_consistent;
    ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_customer_type_check;
    ALTER TABLE estimates
      DROP COLUMN IF EXISTS privacy_consent_version,
      DROP COLUMN IF EXISTS privacy_consent_at,
      DROP COLUMN IF EXISTS customer_type;
  `);
}
