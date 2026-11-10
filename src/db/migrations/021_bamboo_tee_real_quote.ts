import type { Knex } from 'knex';
import { BASE_PRICES, description as marketDescription } from './020_shoes_golf_tee_base_prices';

// The first REAL quote for golf tees (a factory quote received in November 2026, EXW), which replaces
// the Made-in-China.com listing prices of migration 020 for the bamboo tee:
//   70 mm  200 packages x USD 2.00 = USD   400
//   65 mm  600 packages x USD 1.90 = USD 1,140
//   60 mm  200 packages x USD 1.82 = USD   364
//   total 1,000 packages = USD 1,904, i.e. USD 1.904 per package of 50 tees on average.
// The quote is for BAMBOO tees; logo print and the package of 50 are included; EXW (no shipping, duty,
// VAT or service fee). The form has no length field, so the weighted average is used for all lengths.
//
// The price column is per tee: USD 1.904 / 50 = USD 0.03808 x 1,323.9 = 50.4 KRW.
// Wood and plastic tees have no real quote yet. Their listing prices (about 24-33 KRW per tee) are far
// below the quote, so they are switched off: a request for wood, plastic or "not sure" is then priced
// from the bamboo quote with the wider range the service gives to an unknown material.

export const QUOTE_USD_PER_PACKAGE = 1.904;
export const QUOTE_KRW_PER_TEE = 50.4; // QUOTE_USD_PER_PACKAGE / 50 * USD_KRW, to a tenth of a won
const QUOTE_DESCRIPTION =
  'Factory quote 2026-11 (EXW): 1,000 packages of 50 bamboo tees, USD 1.904 per package on average ' +
  '(60/65/70 mm: 1.82/1.90/2.00), logo print and package included, at 1 USD = 1323.9 KRW';

const SWITCHED_OFF = ['Wood Tee', 'Plastic Tee'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `UPDATE base_prices
        SET base_price = ?, description = ?, is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'golf_products' AND product_variant = 'Bamboo Tee'`,
    [QUOTE_KRW_PER_TEE, QUOTE_DESCRIPTION]
  );
  await knex.raw(
    `UPDATE base_prices
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'golf_products' AND product_variant IN (${SWITCHED_OFF.map(() => '?').join(', ')})`,
    SWITCHED_OFF
  );
}

// Puts the three listing prices of migration 020 back.
export async function down(knex: Knex): Promise<void> {
  for (const price of BASE_PRICES.filter(row => row.category === 'golf_products')) {
    await knex.raw(
      `UPDATE base_prices
          SET base_price = ?, description = ?, is_active = true, updated_at = CURRENT_TIMESTAMP
        WHERE category = 'golf_products' AND product_variant = ?`,
      [price.krw, marketDescription(price), price.variant]
    );
  }
}
