import type { Knex } from 'knex';

// Price evidence of sunglasses (2026-11-18): a row can say what frame and which lens the listed product has, the way a golf shoe
// row says its upper, outsole and closure. Two empty columns are added; no row changes.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE price_evidence
      ADD COLUMN frame_material VARCHAR(40),
      ADD COLUMN lens_type VARCHAR(40)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE price_evidence DROP COLUMN IF EXISTS lens_type, DROP COLUMN IF EXISTS frame_material');
}
