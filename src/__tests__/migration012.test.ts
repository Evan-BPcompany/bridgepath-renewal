import fs from 'fs';
import path from 'path';
import { down, up } from '../db/migrations/012_customer_type_and_privacy_consent';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const read = (file: string): string => fs.readFileSync(path.join(migrationsDir, file), 'utf8');
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const FILE = '012_customer_type_and_privacy_consent.ts';

// The SQL itself runs against a real PostgreSQL in the integration suite (migrations.int.test.ts).
// Here: its shape, and the rollback logic against a fake knex.
describe('Migration 012: customer type and privacy consent on estimates', () => {
  const source = read(FILE);
  const [upPart, downPart] = source.split('export async function down');
  // The SQL only, without the explanatory comments (which mention words like UPDATE).
  const withoutComments = (text: string): string => text.replace(/^\s*\/\/.*$/gm, '');

  it('is the file after 011, with no other migration changed or added after it', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    expect(files[files.length - 1]).toBe(FILE);
    expect(files[files.length - 2]).toBe('011_admin_must_change_password.ts');
  });

  describe('up', () => {
    it('adds three nullable columns without a default, idempotently', () => {
      const sql = normalize(upPart);
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS customer_type VARCHAR(30)');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS privacy_consent_version VARCHAR(50)');
      expect(sql).not.toMatch(/NOT NULL|DEFAULT/);
    });

    it('limits customer_type to the two PRD types and nothing else', () => {
      const sql = normalize(upPart);
      expect(sql).toContain(
        "ADD CONSTRAINT estimates_customer_type_check CHECK ( customer_type IS NULL OR customer_type IN ('individual_startup', 'business_brand') )"
      );
    });

    it('requires a consent time and a non-blank version to come together', () => {
      const sql = normalize(upPart);
      expect(sql).toContain('ADD CONSTRAINT estimates_privacy_consent_consistent CHECK');
      expect(sql).toContain('(privacy_consent_at IS NULL) = (privacy_consent_version IS NULL)');
      expect(sql).toContain("(privacy_consent_version IS NULL OR btrim(privacy_consent_version) <> '')");
    });

    it('drops a constraint of the same name first, so it can run twice', () => {
      const sql = normalize(upPart);
      expect(sql.indexOf('DROP CONSTRAINT IF EXISTS estimates_customer_type_check')).toBeGreaterThan(-1);
      expect(sql.indexOf('DROP CONSTRAINT IF EXISTS estimates_customer_type_check')).toBeLessThan(
        sql.indexOf('ADD CONSTRAINT estimates_customer_type_check')
      );
      expect(sql.indexOf('DROP CONSTRAINT IF EXISTS estimates_privacy_consent_consistent')).toBeLessThan(
        sql.indexOf('ADD CONSTRAINT estimates_privacy_consent_consistent')
      );
    });

    it('does not touch existing rows: no UPDATE, INSERT, DELETE or backfill of a consent', () => {
      expect(withoutComments(upPart)).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bTRUNCATE\b/i);
    });

    it('does not use a NOT VALID check (it would also reject later updates of old rows)', () => {
      expect(withoutComments(upPart)).not.toMatch(/NOT VALID/i);
    });
  });

  describe('down', () => {
    it('locks the table, then counts the records, then drops constraints and columns, in that order', () => {
      const lock = downPart.indexOf('LOCK TABLE estimates IN SHARE ROW EXCLUSIVE MODE');
      const count = downPart.indexOf('SELECT count(*)::int AS records');
      const refuse = downPart.indexOf('Refusing to roll back migration 012');
      const drop = downPart.indexOf('DROP COLUMN IF EXISTS');

      expect(lock).toBeGreaterThan(-1);
      expect(lock).toBeLessThan(count);
      expect(count).toBeLessThan(refuse);
      expect(refuse).toBeLessThan(drop);
    });

    it('drops only what up() added', () => {
      const sql = normalize(downPart);
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS estimates_privacy_consent_consistent');
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS estimates_customer_type_check');
      expect(sql).toContain('DROP COLUMN IF EXISTS privacy_consent_version');
      expect(sql).toContain('DROP COLUMN IF EXISTS privacy_consent_at');
      expect(sql).toContain('DROP COLUMN IF EXISTS customer_type');
      expect(downPart).not.toMatch(/DROP TABLE|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/i);
    });

    // A fake knex: raw() records the statements and answers the count query.
    const fakeKnex = (records: number) => {
      const statements: string[] = [];
      const knex = {
        raw: jest.fn(async (sql: string) => {
          statements.push(normalize(sql));
          return { rows: [{ records }] };
        })
      };
      return { knex: knex as never, statements };
    };

    it('throws and runs no DROP while any estimate holds a customer type or a consent', async () => {
      const { knex, statements } = fakeKnex(3);

      await expect(down(knex)).rejects.toThrow(
        /Refusing to roll back migration 012: 3 estimate\(s\) hold a customer type or a privacy consent record/
      );

      expect(statements).toHaveLength(2);
      expect(statements[0]).toBe('LOCK TABLE estimates IN SHARE ROW EXCLUSIVE MODE');
      expect(statements.join(' ')).not.toMatch(/DROP/);
    });

    it('the refusal also covers a row that has only the version or only the time', () => {
      const sql = normalize(downPart);
      expect(sql).toContain(
        'WHERE customer_type IS NOT NULL OR privacy_consent_at IS NOT NULL OR privacy_consent_version IS NOT NULL'
      );
    });

    it('drops the constraints and columns when no estimate holds a record', async () => {
      const { knex, statements } = fakeKnex(0);

      await down(knex);

      expect(statements).toHaveLength(3);
      expect(statements[2]).toContain('DROP COLUMN IF EXISTS customer_type');
    });

    it('up() runs a single statement batch and returns', async () => {
      const raw = jest.fn(async () => ({ rows: [] }));

      await up({ raw } as never);

      expect(raw).toHaveBeenCalledTimes(1);
    });
  });

  it('does not use "?" (knex treats it as a binding placeholder)', () => {
    expect(source).not.toContain('?');
  });

  it('does not modify the original estimates definition or an earlier migration', () => {
    for (const earlier of ['001_init_schema.ts', '008_customer_contact_policy.ts', '011_admin_must_change_password.ts']) {
      expect(read(earlier)).not.toMatch(/customer_type|privacy_consent/);
    }
  });
});
