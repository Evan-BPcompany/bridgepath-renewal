import type { Knex } from 'knex';
import { USD_KRW } from './020_shoes_golf_tee_base_prices';

// ONE base price for the golf shoe (the product of the shoes page), replacing the five general shoe types of migration 020
// (sneakers, heels, men's dress, boots, sandals), which were not golf shoes and made the range run from 8,000 to 47,000 won.
//
// TEMPORARY VALUE (2026-11-17): USD 22.5 a pair. Public sourcing listings of spikeless golf shoes showed about USD 22-26 a pair
// by quantity (USD 25 at 1,000 pairs; USD 15-32 over every listing seen); the first value was USD 25, and the owner found the
// ranges high for the market, so it is 10 % lower: the low end of those listings. It rests on a few listings without stated
// trade terms, so it is a placeholder: replace it with the price of a real factory quote, as 021 did for the bamboo tee. The
// price is per pair, a factory price: no shipping, duty, mold, logo or packaging; the company margin is added when a range is shown.

export const GOLF_SHOE_VARIANT = 'Golf Shoe';
export const GOLF_SHOE_USD = 22.5;
// USD 22.5 x 1,323.9 = 29,787.75, to a hundred won
export const GOLF_SHOE_KRW = Math.round((GOLF_SHOE_USD * USD_KRW) / 100) * 100;

const DESCRIPTION =
  'TEMPORARY 2026-11-17: USD 22.5 per pair of spikeless golf shoes (the low end of public sourcing listings, USD 22-26 by ' +
  `quantity, 10 % under the first value of USD 25), at 1 USD = ${USD_KRW} KRW; factory price per pair, no shipping, duty, mold, ` +
  'logo or packaging. ' +
  'Replace with a real factory quote.';

// The general shoe types of migration 020, switched off (they stay in the table).
export const SWITCHED_OFF = ['Sneakers', 'Heels', 'Mens Dress', 'Boots', 'Sandals'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `INSERT INTO base_prices (category, product_variant, base_price, currency, is_active, description)
     VALUES ('shoes', ?, ?, 'KRW', true, ?)
     ON CONFLICT (category, product_variant) DO UPDATE
       SET base_price = EXCLUDED.base_price,
           currency = EXCLUDED.currency,
           is_active = true,
           description = EXCLUDED.description,
           updated_at = CURRENT_TIMESTAMP`,
    [GOLF_SHOE_VARIANT, GOLF_SHOE_KRW, DESCRIPTION]
  );
  await knex.raw(
    `UPDATE base_prices
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'shoes' AND product_variant IN (${SWITCHED_OFF.map(() => '?').join(', ')})`,
    SWITCHED_OFF
  );
}

// Takes the golf shoe price away and switches the five general shoe types of 020 back on.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM base_prices WHERE category = 'shoes' AND product_variant = ?`, [GOLF_SHOE_VARIANT]);
  await knex.raw(
    `UPDATE base_prices
        SET is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'shoes' AND product_variant IN (${SWITCHED_OFF.map(() => '?').join(', ')})`,
    SWITCHED_OFF
  );
}
