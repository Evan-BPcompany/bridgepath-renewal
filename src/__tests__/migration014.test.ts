import fs from 'fs';
import path from 'path';
import { MATERIAL_VARIANTS } from '../config/sunglassesPricingRules';
import { down, up, SUNGLASSES_BASE_PRICES, USD_KRW } from '../db/migrations/014_sunglasses_base_prices';

/* eslint-disable @typescript-eslint/no-var-requires */
const script = require('../../scripts/sunglasses-base-prices.js');
const dataFile = path.join(__dirname, '..', '..', 'docs', 'pricing', 'sunglasses-factory-prices-2026-10-20.json');
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const FILE = '014_sunglasses_base_prices.ts';

type RawCall = { sql: string; bindings: unknown[] };

function fakeKnex(): { knex: any; calls: RawCall[] } {
  const calls: RawCall[] = [];
  const knex = { raw: jest.fn(async (sql: string, bindings: unknown[] = []) => { calls.push({ sql, bindings }); }) };
  return { knex, calls };
}

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('Migration 014: the first real sunglasses base prices', () => {
  it('is the file right after 013', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf(FILE);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe('013_align_estimate_statuses.ts');
  });

  it('has a price for every material the price preview knows', () => {
    expect(SUNGLASSES_BASE_PRICES.map(price => price.variant).sort()).toEqual(
      Object.values(MATERIAL_VARIANTS).sort()
    );
  });

  it('holds the figures that scripts/sunglasses-base-prices.js computes from the data file', () => {
    expect(data.meta.usd_krw).toBe(USD_KRW);
    const computed = script.compute(data, data.meta.usd_krw);

    Object.keys(computed).forEach(material => {
      const price = SUNGLASSES_BASE_PRICES.find(entry => entry.variant === computed[material].variant);
      expect(price).toBeDefined();
      expect(price!.krw).toBe(computed[material].krw_median);
      expect(price!.usdMedian).toBe(Math.round(computed[material].usd_median * 10000) / 10000);
      expect(price!.listings).toBe(computed[material].listings_used);
    });
  });

  it('orders the materials the way the market does: plastic < metal < wood < mixed < acetate', () => {
    const krw = (variant: string): number => SUNGLASSES_BASE_PRICES.find(price => price.variant === variant)!.krw;

    expect(krw('Plastic Frame')).toBeLessThan(krw('Metal Frame'));
    expect(krw('Metal Frame')).toBeLessThan(krw('Wood Frame'));
    expect(krw('Wood Frame')).toBeLessThan(krw('Mixed Frame'));
    expect(krw('Mixed Frame')).toBeLessThan(krw('Acetate Frame'));
  });

  describe('up', () => {
    it('upserts one row per material and switches the other eyewear samples off', async () => {
      const { knex, calls } = fakeKnex();

      await up(knex);

      expect(calls).toHaveLength(SUNGLASSES_BASE_PRICES.length + 1);
      calls.slice(0, -1).forEach((call, index) => {
        const price = SUNGLASSES_BASE_PRICES[index];
        expect(normalize(call.sql)).toContain("INSERT INTO base_prices (category, product_variant, base_price, currency, is_active, description) VALUES ('eyewear', ?, ?, 'KRW', true, ?)");
        expect(normalize(call.sql)).toContain('ON CONFLICT (category, product_variant) DO UPDATE');
        expect(call.bindings.slice(0, 2)).toEqual([price.variant, price.krw]);
        expect(String(call.bindings[2])).toContain('Made-in-China.com 2026-10-20');
        expect(String(call.bindings[2])).toContain(`median of ${price.listings} factory listings`);
        expect(String(call.bindings[2])).toContain('1330.79');
      });

      const last = calls[calls.length - 1];
      expect(normalize(last.sql)).toContain("SET is_active = false");
      expect(normalize(last.sql)).toContain("category = 'eyewear' AND description LIKE '[SAMPLE]%'");
      expect(last.bindings).toEqual(SUNGLASSES_BASE_PRICES.map(price => price.variant));
    });

    it('deletes and drops nothing', async () => {
      const { knex, calls } = fakeKnex();

      await up(knex);

      calls.forEach(call => expect(call.sql).not.toMatch(/DELETE|DROP|TRUNCATE/i));
    });

    it('touches only the eyewear category', async () => {
      const { knex, calls } = fakeKnex();

      await up(knex);

      calls.forEach(call => {
        expect(call.sql).toContain("'eyewear'");
        expect(call.sql).not.toMatch(/shoes|golf_products|other/);
      });
    });
  });

  describe('down', () => {
    it('removes only the rows this migration wrote and switches the samples back on', async () => {
      const { knex, calls } = fakeKnex();

      await down(knex);

      expect(calls).toHaveLength(2);
      expect(normalize(calls[0].sql)).toBe(
        "DELETE FROM base_prices WHERE category = 'eyewear' AND description LIKE 'Made-in-China.com %'"
      );
      expect(normalize(calls[1].sql)).toContain('SET is_active = true');
      expect(normalize(calls[1].sql)).toContain("description LIKE '[SAMPLE]%'");
    });
  });
});

describe('scripts/sunglasses-base-prices.js', () => {
  const row = (title: string, low: number, high: number, moq: number, supplier = 'A Factory') => [title, low, high, moq, supplier];

  it('keeps a plain factory listing of one material', () => {
    expect(script.passes('acetate', row('Square Acetate Sunglasses', 6, 7, 12))).toBe(true);
  });

  it.each([
    ['a retail shop (MOQ under 6)', row('Square Acetate Sunglasses', 6, 7, 2)],
    ['a range too wide to be one price', row('Square Acetate Sunglasses', 2, 10, 12)],
    ['kids glasses', row('Kids Acetate Sunglasses', 6, 7, 12)],
    ['party glasses', row('Party Acetate Sunglasses', 6, 7, 12)],
    ['a replica', row('Acetate Brand Replicas Sunglasses', 6, 7, 12)],
    ['a clip-on', row('Acetate Clip on Sunglasses', 6, 7, 12)],
    ['another material in the title', row('Acetate Metal Sunglasses', 6, 7, 12)],
    ['no material in the title', row('Fashion Sunglasses', 6, 7, 12)]
  ])('drops %s from the acetate prices', (_name, listing) => {
    expect(script.passes('acetate', listing)).toBe(false);
  });

  it('keeps mixed listings only when they name both materials', () => {
    expect(script.passes('mixed', row('Acetate Metal Sunglasses', 6, 7, 12))).toBe(true);
    expect(script.passes('mixed', row('Acetate Sunglasses', 6, 7, 12))).toBe(false);
    expect(script.passes('mixed', row('Metal Sunglasses', 6, 7, 12))).toBe(false);
  });

  it('does not take a wood print or wooden temples for a wood frame', () => {
    expect(script.passes('wood', row('Bamboo Wood Sunglasses', 5, 6, 20))).toBe(true);
    expect(script.passes('wood', row('Sunglasses with Wood Grain Legs', 5, 6, 20))).toBe(false);
    expect(script.passes('wood', row('Sunglasses with Wooden Temple', 5, 6, 20))).toBe(false);
  });

  it('takes at most two listings of one supplier', () => {
    const rows = [1, 2, 3, 4].map(n => row('Plastic Sunglasses ' + n, n, n + 0.5, 12, 'Same Factory'));

    expect(script.pick('plastic', rows)).toHaveLength(2);
  });

  it('takes the median, of an odd and of an even count', () => {
    expect(script.median([5, 1, 3])).toBe(3);
    expect(script.median([4, 1, 3, 2])).toBe(2.5);
  });

  it('uses the middle of the listed range of each listing', () => {
    const fixture = {
      listings: {
        plastic: [row('Plastic Sunglasses A', 1, 3, 12, 'S1'), row('Plastic Sunglasses B', 2, 2, 12, 'S2'), row('Plastic Sunglasses C', 4, 6, 12, 'S3')],
        metal: [], acetate: [], wood: [], mixed: []
      }
    };

    const result = script.compute(fixture, 1000);

    expect(result.plastic.listings_used).toBe(3);
    // The middles are 2, 2 and 5: the median is 2 dollars, 2,000 won.
    expect(result.plastic.usd_median).toBe(2);
    expect(result.plastic.krw_median).toBe(2000);
    expect(result.metal.krw_median).toBeNull();
  });

  it('rounds won to 10', () => {
    expect(script.toKrw(1.96, 1330.79)).toBe(2610);
    expect(script.toKrw(7.37, 1330.79)).toBe(9810);
  });

  describe('the data file', () => {
    it('has the five materials, each row with a title, a price range, an MOQ and a supplier', () => {
      expect(Object.keys(data.listings).sort()).toEqual(['acetate', 'metal', 'mixed', 'plastic', 'wood']);
      Object.values<any[]>(data.listings).forEach(rows =>
        rows.forEach(listing => {
          expect(typeof listing[0]).toBe('string');
          expect(listing[1]).toBeGreaterThan(0);
          expect(listing[2]).toBeGreaterThanOrEqual(listing[1]);
          expect(Number.isInteger(listing[3])).toBe(true);
          expect(typeof listing[4]).toBe('string');
        })
      );
    });

    it('records where and when the prices were read and at which rate', () => {
      expect(data.meta.retrieved).toBe('2026-10-20');
      expect(data.meta.usd_krw).toBeGreaterThan(0);
      expect(data.meta.source).toContain('Made-in-China.com');
      Object.values<string>(data.meta.pages).forEach(url => expect(url).toMatch(/^https:\/\/www\.made-in-china\.com\//));
    });
  });
});
