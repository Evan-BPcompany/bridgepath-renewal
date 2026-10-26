import fs from 'fs';
import path from 'path';
import { down, up, BASE_PRICES, USD_KRW } from '../db/migrations/020_shoes_golf_tee_base_prices';

/* eslint-disable @typescript-eslint/no-var-requires */
const script = require('../../scripts/shoes-golf-base-prices.js');
const dataFile = path.join(__dirname, '..', '..', 'docs', 'pricing', 'shoes-golf-factory-prices-2026-10-26.json');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const FILE = '020_shoes_golf_tee_base_prices.ts';

type RawCall = { sql: string; bindings: unknown[] };

function fakeKnex(): { knex: any; calls: RawCall[] } {
  const calls: RawCall[] = [];
  const knex = { raw: jest.fn(async (sql: string, bindings: unknown[] = []) => { calls.push({ sql, bindings }); }) };
  return { knex, calls };
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('Migration 020: the first real shoe and golf tee base prices', () => {
  it('is the file right after 019', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf(FILE);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe('019_kakao_notifications.ts');
  });

  it('holds the figures that scripts/shoes-golf-base-prices.js computes from the data file', () => {
    expect(data.meta.usd_krw).toBe(USD_KRW);
    const computed = script.compute(data, data.meta.usd_krw);

    expect(BASE_PRICES).toHaveLength(Object.keys(computed).length);
    Object.keys(computed).forEach(key => {
      const price = BASE_PRICES.find(entry => entry.category === computed[key].category && entry.variant === computed[key].variant);
      expect(price).toBeDefined();
      expect(price!.krw).toBe(computed[key].krw_median);
      expect(price!.usdMedian).toBe(Math.round(computed[key].usd_median * 10000) / 10000);
      expect(price!.listings).toBe(computed[key].listings_used);
      expect(price!.suppliers).toBe(computed[key].suppliers_used);
    });
  });

  it('prices five shoe types and three tee materials', () => {
    expect(BASE_PRICES.filter(price => price.category === 'shoes').map(price => price.variant)).toEqual(['Sneakers', 'Heels', 'Mens Dress', 'Boots', 'Sandals']);
    expect(BASE_PRICES.filter(price => price.category === 'golf_products').map(price => price.variant)).toEqual(['Wood Tee', 'Bamboo Tee', 'Plastic Tee']);
  });

  it('orders the shoes the way the market does: sandals < heels < sneakers < boots < men dress', () => {
    const krw = (variant: string): number => BASE_PRICES.find(price => price.variant === variant)!.krw;

    expect(krw('Sandals')).toBeLessThan(krw('Heels'));
    expect(krw('Heels')).toBeLessThan(krw('Sneakers'));
    expect(krw('Sneakers')).toBeLessThan(krw('Boots'));
    expect(krw('Boots')).toBeLessThan(krw('Mens Dress'));
  });

  describe('up', () => {
    it('upserts one row per price and switches the development samples of the two categories off', async () => {
      const { knex, calls } = fakeKnex();

      await up(knex);

      expect(calls).toHaveLength(BASE_PRICES.length + 2);
      calls.slice(0, BASE_PRICES.length).forEach((call, index) => {
        const price = BASE_PRICES[index];
        expect(normalize(call.sql)).toContain("INSERT INTO base_prices (category, product_variant, base_price, currency, is_active, description) VALUES (?, ?, ?, 'KRW', true, ?)");
        expect(normalize(call.sql)).toContain('ON CONFLICT (category, product_variant) DO UPDATE');
        expect(call.bindings.slice(0, 3)).toEqual([price.category, price.variant, price.krw]);
        expect(String(call.bindings[3])).toContain('Made-in-China.com 2026-10-26');
        expect(String(call.bindings[3])).toContain('1323.9');
      });
      const switches = calls.slice(BASE_PRICES.length);
      switches.forEach(call => expect(normalize(call.sql)).toContain("SET is_active = false"));
      expect(switches[0].bindings).toEqual(['shoes', 'Sneakers', 'Heels', 'Mens Dress', 'Boots', 'Sandals']);
      expect(switches[1].bindings).toEqual(['golf_products', 'Wood Tee', 'Bamboo Tee', 'Plastic Tee']);
    });

    it('deletes and drops nothing, and touches no other category', async () => {
      const { knex, calls } = fakeKnex();

      await up(knex);

      calls.forEach(call => {
        expect(call.sql).not.toMatch(/DELETE|DROP|TRUNCATE/i);
        expect(call.sql).not.toMatch(/eyewear|'other'/);
      });
    });

    it('says in the description that a tee price is per piece and that a thin base is thin', () => {
      const plastic = BASE_PRICES.find(price => price.variant === 'Plastic Tee')!;

      expect(plastic.suppliers).toBe(1);
    });
  });

  describe('down', () => {
    it('removes only the rows this migration wrote and switches the samples back on', async () => {
      const { knex, calls } = fakeKnex();

      await down(knex);

      expect(calls).toHaveLength(2);
      expect(normalize(calls[0].sql)).toBe(
        "DELETE FROM base_prices WHERE category IN ('shoes', 'golf_products') AND description LIKE 'Made-in-China.com %'"
      );
      expect(normalize(calls[1].sql)).toContain('SET is_active = true');
      expect(normalize(calls[1].sql)).toContain("description LIKE '[SAMPLE]%'");
    });
  });
});

describe('scripts/shoes-golf-base-prices.js', () => {
  const row = (title: string, low: number, high: number, moq: number, supplier = 'A Factory') => [title, low, high, moq, supplier];

  it('keeps a plain factory listing of a shoe', () => {
    expect(script.passes(script.RULES.sneakers, row('Men Running Sneakers', 10, 11, 300))).toBe(true);
  });

  it.each([
    ['a retail shop (MOQ under 100 pairs)', row('Men Running Sneakers', 10, 11, 2)],
    ['a range too wide to be one price', row('Men Running Sneakers', 2, 10, 300)],
    ['kids shoes', row('Kids Running Sneakers', 10, 11, 300)],
    ['safety shoes', row('Safety Sneaker', 10, 11, 300)],
    ['hotel slippers', row('Hotel Slippers', 10, 11, 300)]
  ])('drops %s', (_name, listing) => {
    expect(script.passes(script.RULES.sneakers, listing)).toBe(false);
  });

  it('keeps tee listings by material, and not the mixed ones', () => {
    expect(script.passes(script.RULES.tee_wood, row('Wooden Golf Tees', 0.01, 0.02, 1000))).toBe(true);
    expect(script.passes(script.RULES.tee_wood, row('Wooden Bamboo Golf Tees', 0.01, 0.02, 1000))).toBe(false);
    expect(script.passes(script.RULES.tee_bamboo, row('Bamboo Golf Tees', 0.01, 0.02, 1000))).toBe(true);
    expect(script.passes(script.RULES.tee_plastic, row('Bamboo Plastic Tees', 0.01, 0.02, 1000))).toBe(false);
  });

  it('drops a tee novelty (MOQ in the tens)', () => {
    expect(script.passes(script.RULES.tee_plastic, row('Plastic Golf Tees', 0.09, 0.09, 20))).toBe(false);
  });

  it('keeps at most two listings of one supplier', () => {
    const rows = [1, 2, 3, 4].map(n => row('Men Running Sneakers', 10 + n, 11 + n, 300, 'Same Factory'));

    expect(script.pick(script.RULES.sneakers, rows)).toHaveLength(2);
  });

  it('takes the middle of the range of each listing, the median of those, and rounds tees to 0.1 won', () => {
    expect(script.median([1, 3, 2])).toBe(2);
    expect(script.median([1, 2, 3, 4])).toBe(2.5);
    expect(script.toKrw(10.47, 1323.9, 'shoes')).toBe(13860);
    expect(script.toKrw(0.018, 1323.9, 'golf_products')).toBe(23.8);
  });
});
