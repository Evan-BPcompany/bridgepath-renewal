import fs from 'fs';
import path from 'path';
import { down, up } from '../db/migrations/013_align_estimate_statuses';

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const read = (file: string): string => fs.readFileSync(path.join(migrationsDir, file), 'utf8');
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const withoutComments = (text: string): string => text.replace(/^\s*\/\/.*$/gm, '');

const FILE = '013_align_estimate_statuses.ts';
const NEW = [
  'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
  'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
];
const OLD = [
  'new_receipt', 'under_review', 'quoted', 'negotiating', 'accepted',
  'completed', 'cancelled', 'rejected', 'on_hold', 'archived'
];

// The SQL runs against a real PostgreSQL in the integration suite (migrations.int.test.ts).
// Here: its shape, and the logic of up() and down() against a fake knex.
describe('Migration 013: align estimates.status with the PRD', () => {
  const source = read(FILE);
  const [upPart, downPart] = source.split('export async function down');
  const upSql = normalize(withoutComments(upPart));
  const downSql = normalize(withoutComments(downPart));

  it('is the file after 012 and the last migration', () => {
    const files = fs.readdirSync(migrationsDir).filter(name => /^\d{3}_/.test(name)).sort();
    expect(files[files.length - 1]).toBe(FILE);
    expect(files[files.length - 2]).toBe('012_customer_type_and_privacy_consent.ts');
  });

  describe('up', () => {
    it('locks the table first, then backs up, then drops the old CHECK, migrates, adds the new CHECK', () => {
      const order = [
        upSql.indexOf('LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE'),
        upSql.indexOf('CREATE TABLE estimate_status_backup'),
        upSql.indexOf('INSERT INTO estimate_status_backup'),
        upSql.indexOf('DROP CONSTRAINT'),
        upSql.indexOf('UPDATE estimates SET status = CASE'),
        upSql.indexOf('ADD CONSTRAINT estimates_status_check')
      ];

      expect(order.every(position => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('maps exactly rejected -> cancelled, archived -> completed, negotiating -> customer_review', () => {
      const update = upSql.slice(upSql.indexOf('UPDATE estimates SET status = CASE'));
      expect(update).toContain("WHEN 'rejected' THEN 'cancelled'");
      expect(update).toContain("WHEN 'archived' THEN 'completed'");
      expect(update).toContain("WHEN 'negotiating' THEN 'customer_review'");
      expect(update).toContain("WHERE status IN ('rejected', 'archived', 'negotiating')");
      expect((update.match(/WHEN '/g) ?? []).length).toBe(3);
    });

    it('backs up only the rows it changes, with the value it gives them', () => {
      expect(upSql).toContain(
        "FROM estimates WHERE status IN ('rejected', 'archived', 'negotiating')"
      );
      expect(upSql).toContain('original_status VARCHAR(50) NOT NULL');
      expect(upSql).toContain('migrated_status VARCHAR(50) NOT NULL');
      expect(upSql).toContain('estimate_id UUID PRIMARY KEY REFERENCES estimates(id) ON DELETE CASCADE');
    });

    it('does not change updated_at', () => {
      const update = upSql.slice(upSql.indexOf('UPDATE estimates SET status = CASE'));
      expect(update).not.toContain('updated_at');
    });

    it('adds a CHECK with exactly the ten statuses of the PRD', () => {
      const add = upSql.slice(upSql.indexOf('ADD CONSTRAINT estimates_status_check'));
      const listed = [...add.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
      expect(listed).toEqual([]);
      // The list is built from NEW_STATUSES; compare that constant.
      const constant = source.match(/const NEW_STATUSES = \[([\s\S]*?)\];/)![1];
      expect([...constant.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort()).toEqual([...NEW].sort());
    });

    it('never touches status_history', () => {
      expect(withoutComments(source)).not.toMatch(/status_history/);
    });

    it('looks the old CHECK up in the catalog instead of assuming its name', () => {
      expect(upSql).toContain('pg_constraint');
      expect(upSql).toContain("conrelid = 'estimates'::regclass");
      expect(upSql).toContain("contype = 'c'");
      expect(upSql).toContain('pg_get_constraintdef(oid)');
      expect(upSql).not.toContain('DROP CONSTRAINT estimates_status_check');
    });
  });

  describe('down', () => {
    it('locks, refuses on the new statuses, drops the new CHECK, restores, renames, verifies, recreates the old CHECK, drops the backup', () => {
      const order = [
        downSql.indexOf('LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE'),
        downSql.indexOf("WHERE status IN ('info_requested', 'factory_checking')"),
        downSql.indexOf('Refusing to roll back migration 013'),
        downSql.indexOf('DROP CONSTRAINT'),
        downSql.indexOf('FROM estimate_status_backup b'),
        downSql.indexOf("SET status = 'negotiating' WHERE status = 'customer_review'"),
        downSql.indexOf('WHERE status NOT IN ('),
        downSql.indexOf('ADD CONSTRAINT estimates_status_check'),
        downSql.indexOf('DROP TABLE estimate_status_backup')
      ];

      expect(order.every(position => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('the new CHECK is dropped before any status is restored (it forbids the old ones), and the old CHECK is created only after the check of the result', () => {
      expect(downSql.indexOf('DROP CONSTRAINT')).toBeLessThan(downSql.indexOf('SET status = b.original_status'));
      expect(downSql.indexOf('WHERE status NOT IN (')).toBeLessThan(downSql.indexOf('ADD CONSTRAINT estimates_status_check'));
      // Exactly one constraint is dropped and one is added: no CHECK is left out or doubled.
      expect((downSql.match(/DROP CONSTRAINT/g) ?? []).length).toBe(1);
      expect((downSql.match(/ADD CONSTRAINT/g) ?? []).length).toBe(1);
    });

    it('refuses before it changes anything: no UPDATE, DROP or ALTER comes before the refusal', () => {
      const beforeRefusal = downSql.slice(0, downSql.indexOf('Refusing to roll back migration 013'));
      expect(beforeRefusal).not.toMatch(/UPDATE|DROP|ALTER|CREATE|INSERT|DELETE/);
    });

    it('restores a backed-up row only while it still has the status up() gave it', () => {
      expect(downSql).toContain('SET status = b.original_status');
      expect(downSql).toContain('AND e.status = b.migrated_status');
    });

    it('never touches status_history', () => {
      expect(downPart).not.toMatch(/status_history/);
    });

    it('puts back the original ten statuses', () => {
      const constant = source.match(/const OLD_STATUSES = \[([\s\S]*?)\];/)![1];
      expect([...constant.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort()).toEqual([...OLD].sort());
    });

    it('the statuses it puts back are exactly those of the CHECK in migration 001', () => {
      const first = read('001_init_schema.ts');
      const check = first.match(/status VARCHAR\(50\) NOT NULL DEFAULT 'new_receipt' CHECK \(status IN \(([\s\S]*?)\)\)/);
      expect(check).not.toBeNull();
      const original = [...check![1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
      const constant = source.match(/const OLD_STATUSES = \[([\s\S]*?)\];/)![1];

      expect([...constant.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort()).toEqual([...original].sort());
      expect(original).toHaveLength(10);
    });
  });

  // A fake knex: raw() records the statements and answers by what they ask for.
  const fakeKnex = (options: {
    constraints?: Array<{ conname: string }>;
    blocking?: number;
    outside?: number;
  }) => {
    const statements: string[] = [];
    const bindings: unknown[][] = [];
    const knex = {
      raw: jest.fn(async (sql: string, binds?: unknown[]) => {
        const text = normalize(sql);
        statements.push(text);
        bindings.push(binds ?? []);
        if (text.includes('FROM pg_constraint')) {
          return { rows: options.constraints ?? [{ conname: 'estimates_status_check' }] };
        }
        if (text.includes("WHERE status IN ('info_requested', 'factory_checking')")) {
          return { rows: [{ rows: options.blocking ?? 0 }] };
        }
        if (text.includes('WHERE status NOT IN (')) {
          return { rows: [{ rows: options.outside ?? 0 }] };
        }
        return { rows: [] };
      })
    };
    return { knex: knex as never, statements, bindings };
  };

  describe('up() against a fake knex', () => {
    it('drops the constraint it found, by its real name, as an identifier binding', async () => {
      const { knex, statements, bindings } = fakeKnex({ constraints: [{ conname: 'estimates_status_check1' }] });

      await up(knex);

      const drop = statements.findIndex(statement => statement.startsWith('ALTER TABLE estimates DROP CONSTRAINT'));
      expect(statements[drop]).toBe('ALTER TABLE estimates DROP CONSTRAINT ??');
      expect(bindings[drop]).toEqual(['estimates_status_check1']);
    });

    it.each([[[]], [[{ conname: 'a' }, { conname: 'b' }]]])(
      'stops when it does not find exactly one status CHECK (%j), before it drops or changes anything',
      async constraints => {
        const { knex, statements } = fakeKnex({ constraints });

        await expect(up(knex)).rejects.toThrow(/exactly one CHECK constraint on estimates.status/);

        expect(statements.some(statement => statement.startsWith('ALTER TABLE estimates DROP'))).toBe(false);
        expect(statements.some(statement => statement.startsWith('UPDATE estimates'))).toBe(false);
      }
    );
  });

  describe('down() against a fake knex', () => {
    const index = (statements: string[], part: string) => statements.findIndex(statement => statement.includes(part));

    it('refuses while an estimate is in info_requested or factory_checking, before it changes anything', async () => {
      const { knex, statements } = fakeKnex({ blocking: 2 });

      await expect(down(knex)).rejects.toThrow(
        /Refusing to roll back migration 013: 2 estimate\(s\) are in info_requested or factory_checking/
      );

      // Only the lock and the look at the blocking rows: nothing was dropped, updated or created.
      expect(statements).toHaveLength(2);
      expect(statements[0]).toBe('LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE');
      expect(statements.some(statement => /^(UPDATE|ALTER|DROP|CREATE|INSERT)/.test(statement))).toBe(false);
      expect(statements.some(statement => statement.includes('pg_constraint'))).toBe(false);
    });

    it('runs its statements in the required order when nothing blocks', async () => {
      const { knex, statements, bindings } = fakeKnex({ constraints: [{ conname: 'the_new_check' }] });

      await down(knex);

      const positions = [
        index(statements, 'LOCK TABLE estimates IN ACCESS EXCLUSIVE MODE'),
        index(statements, "WHERE status IN ('info_requested', 'factory_checking')"),
        index(statements, 'SELECT conname FROM pg_constraint'),
        index(statements, 'ALTER TABLE estimates DROP CONSTRAINT ??'),
        index(statements, 'UPDATE estimates e SET status = b.original_status'),
        index(statements, "UPDATE estimates SET status = 'negotiating'"),
        index(statements, 'WHERE status NOT IN ('),
        index(statements, 'ADD CONSTRAINT estimates_status_check'),
        index(statements, 'DROP TABLE estimate_status_backup')
      ];
      expect(positions.every(position => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // The constraint that goes is the one found in the catalog, by its real name.
      expect(bindings[positions[3]]).toEqual(['the_new_check']);
      // The one that comes back is the old one with the original ten statuses.
      const added = statements[positions[7]];
      for (const status of OLD) {
        expect(added).toContain(`'${status}'`);
      }
      expect(added).not.toContain('customer_review');
      expect(added).not.toContain('info_requested');
      expect(statements[statements.length - 1]).toBe('DROP TABLE estimate_status_backup');
    });

    it('looks for the new CHECK by what only it mentions (customer_review)', async () => {
      const { knex, statements } = fakeKnex({});

      await down(knex);

      const lookup = statements.find(statement => statement.includes('pg_constraint'))!;
      expect(lookup).toContain("LIKE '%customer_review%'");
      expect(lookup).not.toContain('new_receipt');
    });

    it('fails when the new CHECK is not found exactly once, before it restores anything', async () => {
      const { knex, statements } = fakeKnex({ constraints: [] });

      await expect(down(knex)).rejects.toThrow(/exactly one CHECK constraint on estimates.status/);

      expect(statements.some(statement => statement.startsWith('UPDATE estimates'))).toBe(false);
      expect(statements.some(statement => statement.startsWith('DROP TABLE'))).toBe(false);
    });

    it('fails when a status would be left outside the old set: no old CHECK, no DROP TABLE (the transaction undoes the rest)', async () => {
      const { knex, statements } = fakeKnex({ outside: 1 });

      await expect(down(knex)).rejects.toThrow(/would leave 1 estimate\(s\) with a status/);

      expect(statements.some(statement => statement.includes('ADD CONSTRAINT'))).toBe(false);
      expect(statements.some(statement => statement.startsWith('DROP TABLE'))).toBe(false);
      // The restore had run by then, which is why the migration relies on its transaction.
      expect(statements.some(statement => statement.includes('SET status = b.original_status'))).toBe(true);
    });

    it('never touches status_history', async () => {
      const down13 = fakeKnex({});
      const up13 = fakeKnex({});

      await down(down13.knex);
      await up(up13.knex);

      expect(down13.statements.join(' ')).not.toContain('status_history');
      expect(up13.statements.join(' ')).not.toContain('status_history');
    });
  });

  it('does not modify an earlier migration', () => {
    for (const earlier of ['001_init_schema.ts', '012_customer_type_and_privacy_consent.ts']) {
      expect(read(earlier)).not.toMatch(/info_requested|factory_checking|customer_review|estimate_status_backup/);
    }
  });
});
