import * as fs from 'fs';
import * as path from 'path';
import type { Knex } from 'knex';
import { down, up } from '../db/migrations/023_price_evidence';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const fakeKnex = () => {
  const calls: string[] = [];
  const knex = { raw: async (sql: string) => { calls.push(sql.replace(/\s+/g, ' ').trim()); } };
  return { knex: knex as unknown as Knex, calls };
};

describe('Migration 023: price evidence', () => {
  it('is the file right after 022', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    const index = files.indexOf('023_price_evidence.ts');

    expect(index).toBeGreaterThan(0);
    expect(files[index - 1]).toBe('022_golf_shoe_temporary_price.ts');
  });

  it('creates one new table and touches no existing one', async () => {
    const { knex, calls } = fakeKnex();
    await up(knex);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('CREATE TABLE price_evidence');
    expect(calls[0]).not.toMatch(/ALTER TABLE|UPDATE |DELETE |INSERT /);
  });

  it('keeps the checks in the database as well: kinds, status, range, source and approval', async () => {
    const { knex, calls } = fakeKnex();
    await up(knex);

    expect(calls[0]).toContain("price_kind IN ('listing', 'quote', 'retail')");
    expect(calls[0]).toContain("status IN ('candidate', 'approved', 'rejected')");
    expect(calls[0]).toContain('CHECK (price_max >= price_min)');
    expect(calls[0]).toContain("price_kind = 'quote' OR source_url IS NOT NULL");
    expect(calls[0]).toContain("status <> 'approved' OR approved_at IS NOT NULL");
    expect(calls[0]).toContain('CREATE UNIQUE INDEX uq_price_evidence_source');
  });

  it('drops the table on the way down', async () => {
    const { knex, calls } = fakeKnex();
    await down(knex);

    expect(calls).toEqual(['DROP TABLE IF EXISTS price_evidence']);
  });
});
