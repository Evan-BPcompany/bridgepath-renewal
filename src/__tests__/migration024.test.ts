import * as fs from 'fs';
import * as path from 'path';
import type { Knex } from 'knex';
import { down, up } from '../db/migrations/024_price_evidence_eyewear_parts';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const fakeKnex = () => {
  const calls: string[] = [];
  const knex = { raw: async (sql: string) => { calls.push(sql.replace(/\s+/g, ' ').trim()); } };
  return { knex: knex as unknown as Knex, calls };
};

describe('Migration 024: frame and lens of the price evidence', () => {
  it('is the file right after 023', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf('024_price_evidence_eyewear_parts.ts');

    expect(files[index - 1]).toBe('023_price_evidence.ts');
  });

  it('adds two empty columns and changes no row', async () => {
    const { knex, calls } = fakeKnex();
    await up(knex);

    expect(calls).toEqual(['ALTER TABLE price_evidence ADD COLUMN frame_material VARCHAR(40), ADD COLUMN lens_type VARCHAR(40)']);
  });

  it('drops them on the way down', async () => {
    const { knex, calls } = fakeKnex();
    await down(knex);

    expect(calls).toEqual(['ALTER TABLE price_evidence DROP COLUMN IF EXISTS lens_type, DROP COLUMN IF EXISTS frame_material']);
  });
});
