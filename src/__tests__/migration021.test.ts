import * as fs from 'fs';
import * as path from 'path';
import type { Knex } from 'knex';
import { down, up, QUOTE_KRW_PER_TEE, QUOTE_USD_PER_PACKAGE } from '../db/migrations/021_bamboo_tee_real_quote';
import { USD_KRW } from '../db/migrations/020_shoes_golf_tee_base_prices';
import { calculateGolfTeePreview } from '../services/estimatePreviewService';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const fakeKnex = () => {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const knex = { raw: async (sql: string, bindings: unknown[]) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), bindings }); } };
  return { knex: knex as unknown as Knex, calls };
};

describe('Migration 021: the bamboo tee real quote', () => {
  it('is the file right after 020', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf('021_bamboo_tee_real_quote.ts');
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe('020_shoes_golf_tee_base_prices.ts');
  });

  it('holds the average of the quote: (200 x 2.00 + 600 x 1.90 + 200 x 1.82) / 1000 = USD 1.904 a package', () => {
    expect((200 * 2.0 + 600 * 1.9 + 200 * 1.82) / 1000).toBeCloseTo(QUOTE_USD_PER_PACKAGE, 6);
    expect(QUOTE_KRW_PER_TEE).toBe(Math.round((QUOTE_USD_PER_PACKAGE / 50) * USD_KRW * 10) / 10);
  });

  it('sets the bamboo tee price and switches wood and plastic off', async () => {
    const { knex, calls } = fakeKnex();
    await up(knex);

    expect(calls).toHaveLength(2);
    expect(calls[0].bindings[0]).toBe(QUOTE_KRW_PER_TEE);
    expect(calls[0].sql).toContain("product_variant = 'Bamboo Tee'");
    expect(calls[1].sql).toContain('is_active = false');
    expect(calls[1].bindings).toEqual(['Wood Tee', 'Plastic Tee']);
  });

  it('puts the three listing prices of 020 back on the way down', async () => {
    const { knex, calls } = fakeKnex();
    await down(knex);

    expect(calls.map(call => call.bindings[0])).toEqual([23.8, 33.1, 33.1]);
    expect(calls.map(call => call.bindings[2])).toEqual(['Wood Tee', 'Bamboo Tee', 'Plastic Tee']);
  });

  it('prices 1,000 packages of bamboo tees around USD 1.90 a package (about 2,520 won)', () => {
    const rows = [{ product_variant: 'Bamboo Tee', base_price: QUOTE_KRW_PER_TEE }];
    const bamboo = calculateGolfTeePreview({ material: 'bamboo', quantity: 1000 }, rows) as { unit_price: { min: number; max: number } };
    const wood = calculateGolfTeePreview({ material: 'wood', quantity: 1000 }, rows) as { unit_price: { min: number; max: number } };

    expect(bamboo.unit_price.min).toBeLessThan(2520);
    expect(bamboo.unit_price.max).toBeGreaterThan(2520);
    expect(wood.unit_price.min).toBeLessThan(bamboo.unit_price.min);
    expect(wood.unit_price.max).toBeGreaterThan(bamboo.unit_price.max);
  });
});
