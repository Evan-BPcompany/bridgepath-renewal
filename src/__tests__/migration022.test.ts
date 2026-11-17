import * as fs from 'fs';
import * as path from 'path';
import type { Knex } from 'knex';
import { down, up, GOLF_SHOE_KRW, GOLF_SHOE_USD, GOLF_SHOE_VARIANT, SWITCHED_OFF } from '../db/migrations/022_golf_shoe_temporary_price';
import { BASE_PRICES, USD_KRW } from '../db/migrations/020_shoes_golf_tee_base_prices';
import { GOLF_SHOE_VARIANT as RULES_VARIANT } from '../config/shoesGolfPricingRules';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const fakeKnex = () => {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const knex = { raw: async (sql: string, bindings: unknown[]) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), bindings }); } };
  return { knex: knex as unknown as Knex, calls };
};

describe('Migration 022: one temporary base price for the golf shoe', () => {
  it('is the file right after 021', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf('022_golf_shoe_temporary_price.ts');
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe('021_bamboo_tee_real_quote.ts');
  });

  it('is USD 22.5 a pair (10 % under the first USD 25) at 1 USD = 1,323.9 KRW, to a hundred won: 29,800', () => {
    expect(GOLF_SHOE_USD).toBe(22.5);
    expect(GOLF_SHOE_KRW).toBe(Math.round((22.5 * USD_KRW) / 100) * 100);
    expect(GOLF_SHOE_KRW).toBe(29800);
  });

  it('uses the variant name that the pricing rules look for', () => {
    expect(GOLF_SHOE_VARIANT).toBe(RULES_VARIANT);
  });

  it('writes the price (marked as temporary) and switches the five general shoe types off', async () => {
    const { knex, calls } = fakeKnex();
    await up(knex);

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('INSERT INTO base_prices');
    expect(calls[0].bindings[0]).toBe('Golf Shoe');
    expect(calls[0].bindings[1]).toBe(29800);
    expect(String(calls[0].bindings[2])).toContain('TEMPORARY');
    expect(calls[1].sql).toContain('is_active = false');
    expect(calls[1].bindings).toEqual(['Sneakers', 'Heels', 'Mens Dress', 'Boots', 'Sandals']);
  });

  it('switches off exactly the shoe types of migration 020', () => {
    const shoeVariants = BASE_PRICES.filter(price => price.category === 'shoes').map(price => price.variant);

    expect([...SWITCHED_OFF].sort()).toEqual([...shoeVariants].sort());
  });

  it('takes the price away and switches the five types back on, on the way down', async () => {
    const { knex, calls } = fakeKnex();
    await down(knex);

    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain('DELETE FROM base_prices');
    expect(calls[0].bindings).toEqual(['Golf Shoe']);
    expect(calls[1].sql).toContain('is_active = true');
    expect(calls[1].bindings).toEqual(SWITCHED_OFF);
  });
});
