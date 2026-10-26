import type { Knex } from 'knex';

// First real base prices for shoes (category 'shoes', one row per shoe type) and golf tees (category
// 'golf_products', one row per material, per piece): the median factory price of China listings on
// Made-in-China.com read on 2026-10-26, converted to KRW at 1 USD = 1,323.9 KRW. The listings, the
// filters and the arithmetic are in docs/pricing/ and scripts/shoes-golf-base-prices.js;
// __tests__/migration020.test.ts checks that the figures below are the ones that script computes from
// the data file. The same method as the sunglasses (migration 014).
//
// What a price means: a factory price per pair (shoes) or per tee (golf) as listed (FOB-style), at the
// middle of the listed range. It does not include shipping, duty, mold, logo, packaging (a package of
// 50 tees included) or the service fee. It is an opening estimate: replace it with the figures of real
// quotes as they come in. The golf tee rows rest on few suppliers (see usdMedian and suppliers).

export interface MarketPrice {
  category: 'shoes' | 'golf_products';
  variant: string;
  krw: number;
  usdMedian: number;
  listings: number;
  suppliers: number;
}

export const BASE_PRICES: ReadonlyArray<MarketPrice> = [
  { category: 'shoes', variant: 'Sneakers', krw: 13860, usdMedian: 10.47, listings: 6, suppliers: 4 },
  { category: 'shoes', variant: 'Heels', krw: 11430, usdMedian: 8.635, listings: 6, suppliers: 4 },
  { category: 'shoes', variant: 'Mens Dress', krw: 24030, usdMedian: 18.15, listings: 6, suppliers: 5 },
  { category: 'shoes', variant: 'Boots', krw: 16400, usdMedian: 12.39, listings: 10, suppliers: 9 },
  { category: 'shoes', variant: 'Sandals', krw: 7910, usdMedian: 5.975, listings: 14, suppliers: 10 },
  { category: 'golf_products', variant: 'Wood Tee', krw: 23.8, usdMedian: 0.018, listings: 4, suppliers: 3 },
  { category: 'golf_products', variant: 'Bamboo Tee', krw: 33.1, usdMedian: 0.025, listings: 3, suppliers: 2 },
  { category: 'golf_products', variant: 'Plastic Tee', krw: 33.1, usdMedian: 0.025, listings: 2, suppliers: 1 }
];

export const USD_KRW = 1323.9;
export const PRICE_DATE = '2026-10-26';

const description = (price: MarketPrice): string =>
  `Made-in-China.com ${PRICE_DATE}: median of ${price.listings} factory listings of ${price.suppliers} suppliers, ` +
  `USD ${price.usdMedian} at 1 USD = ${USD_KRW} KRW (factory price per ${price.category === 'shoes' ? 'pair' : 'piece'}, no shipping, duty, mold, logo or packaging)`;

export async function up(knex: Knex): Promise<void> {
  for (const price of BASE_PRICES) {
    await knex.raw(
      `INSERT INTO base_prices (category, product_variant, base_price, currency, is_active, description)
       VALUES (?, ?, ?, 'KRW', true, ?)
       ON CONFLICT (category, product_variant) DO UPDATE
         SET base_price = EXCLUDED.base_price,
             currency = EXCLUDED.currency,
             is_active = true,
             description = EXCLUDED.description,
             updated_at = CURRENT_TIMESTAMP`,
      [price.category, price.variant, price.krw, description(price)]
    );
  }

  // The development samples of these two categories (Canvas/Leather/Athletic shoes, golf ball/club/bag)
  // would stretch every range, so they are switched off. They stay in the table.
  for (const category of ['shoes', 'golf_products'] as const) {
    const variants = BASE_PRICES.filter(price => price.category === category).map(price => price.variant);
    await knex.raw(
      `UPDATE base_prices
          SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE category = ?
          AND description LIKE '[SAMPLE]%'
          AND product_variant NOT IN (${variants.map(() => '?').join(', ')})`,
      [category, ...variants]
    );
  }
}

// Removes the prices this migration wrote and switches the development samples back on.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM base_prices WHERE category IN ('shoes', 'golf_products') AND description LIKE 'Made-in-China.com %'`
  );
  await knex.raw(
    `UPDATE base_prices
        SET is_active = true, updated_at = CURRENT_TIMESTAMP
      WHERE category IN ('shoes', 'golf_products') AND description LIKE '[SAMPLE]%'`
  );
}
