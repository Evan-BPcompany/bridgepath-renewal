import fs from 'fs';
import path from 'path';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const read = (file: string): string => fs.readFileSync(path.join(migrationsDir, file), 'utf8');

const SEED_HASH = '$2b$12$V9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jKMm.';
const SEED_ID = 'a0000000-0000-0000-0000-000000000001';

describe('Migration 011: admin_users.must_change_password', () => {
  const source = read('011_admin_must_change_password.ts');
  const [upPart, downPart] = source.split('export async function down');

  it('adds the column as BOOLEAN NOT NULL DEFAULT false, idempotently', () => {
    expect(upPart).toMatch(
      /ALTER TABLE admin_users\s+ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false/
    );
  });

  it('flags only the untouched seeded master account', () => {
    expect(upPart).toContain('SET must_change_password = true');
    expect(upPart).toContain(`WHERE id = '${SEED_ID}'::uuid`);
    expect(upPart).toContain("AND username = 'master'");
    expect(upPart).toContain(`AND password_hash = '${SEED_HASH}'`);
    expect(upPart.match(/UPDATE admin_users/g)).toHaveLength(1);
  });

  it('adds the column before it updates the row', () => {
    expect(upPart.indexOf('ADD COLUMN')).toBeLessThan(upPart.indexOf('UPDATE admin_users'));
  });

  it('uses the same id and hash that migration 005 seeds', () => {
    const seed = read('005_seed_dev_data.ts');
    expect(seed).toContain(`'${SEED_ID}'::uuid`);
    expect(seed).toContain(`'${SEED_HASH}'`);
  });

  it('down drops only the column, idempotently', () => {
    expect(downPart).toContain('ALTER TABLE admin_users DROP COLUMN IF EXISTS must_change_password');
    expect(downPart).not.toMatch(/DROP TABLE|DELETE|TRUNCATE|UPDATE/i);
  });

  it('does not use "?" (knex treats it as a binding placeholder)', () => {
    expect(source).not.toContain('?');
  });

  it('does not modify the original admin_users definition or the seed migration', () => {
    expect(read('001_init_schema.ts')).not.toContain('must_change_password');
    expect(read('005_seed_dev_data.ts')).not.toContain('must_change_password');
  });
});
