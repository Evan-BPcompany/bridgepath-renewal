import type { Knex } from 'knex';

// First real base prices for sunglasses (category 'eyewear'): the median factory price of China
// listings on Made-in-China.com read on 2026-10-20, converted to KRW at 1 USD = 1,330.79 KRW.
// The listings, the filters and the arithmetic are in docs/pricing/ and
// scripts/sunglasses-base-prices.js; __tests__/migration014.test.ts checks that the figures below
// are the ones that script computes from the data file.
//
// What a price means: a factory price per piece as listed (FOB-style), at the middle of the listed
// range. It does not include shipping, duty, mold, logo, packaging or the service fee. It is an
// opening estimate: replace it with the figures of real quotes as they come in.

export const SUNGLASSES_BASE_PRICES: ReadonlyArray<{
  variant: string;
  krw: number;
  usdMedian: number;
  listings: number;
}> = [
  { variant: 'Plastic Frame', krw: 2600, usdMedian: 1.955, listings: 12 },
  { variant: 'Metal Frame', krw: 5190, usdMedian: 3.9025, listings: 14 },
  { variant: 'Acetate Frame', krw: 9810, usdMedian: 7.3725, listings: 16 },
  { variant: 'Wood Frame', krw: 6750, usdMedian: 5.07, listings: 10 },
  { variant: 'Mixed Frame', krw: 8620, usdMedian: 6.475, listings: 14 }
];

export const USD_KRW = 1330.79;
export const PRICE_DATE = '2026-10-20';

const description = (usdMedian: number, listings: number): string =>
  `Made-in-China.com ${PRICE_DATE}: median of ${listings} factory listings, ` +
  `USD ${usdMedian} at 1 USD = ${USD_KRW} KRW (factory price, no shipping, duty, mold or logo)`;

export async function up(knex: Knex): Promise<void> {
  for (const price of SUNGLASSES_BASE_PRICES) {
    // Replaces the development sample of the same variant (Plastic Frame, Metal Frame) and adds
    // the variants that had no row (Acetate, Wood, Mixed).
    await knex.raw(
      `INSERT INTO base_prices (category, product_variant, base_price, currency, is_active, description)
       VALUES ('eyewear', ?, ?, 'KRW', true, ?)
       ON CONFLICT (category, product_variant) DO UPDATE
         SET base_price = EXCLUDED.base_price,
             currency = EXCLUDED.currency,
             is_active = true,
             description = EXCLUDED.description,
             updated_at = CURRENT_TIMESTAMP`,
      [price.variant, price.krw, description(price.usdMedian, price.listings)]
    );
  }

  // The other development sample of eyewear (Premium Frame) would stretch the range of an
  // unknown material up to 50,000 won, so it is switched off. It stays in the table.
  await knex.raw(
    `UPDATE base_prices
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'eyewear'
        AND description LIKE '[SAMPLE]%'
        AND product_variant NOT IN (${SUNGLASSES_BASE_PRICES.map(() => '?').join(', ')})`,
    SUNGLASSES_BASE_PRICES.map(price => price.variant)
  );
}

// Removes the prices this migration wrote and switches the development sample back on. The
// development samples of Plastic Frame and Metal Frame were overwritten by up(): run the seed
// (005) again if they are wanted.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM base_prices WHERE category = 'eyewear' AND description LIKE 'Made-in-China.com %'`
  );
  await knex.raw(
    `UPDATE base_prices
        SET is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE category = 'eyewear' AND description LIKE '[SAMPLE]%'`
  );
}
