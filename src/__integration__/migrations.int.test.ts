jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import {
  migrateDownOne,
  migrateLatest,
  rollbackAll,
  snapshotSchema
} from './helpers/database';
import { MASTER_ID, insertAdmin, insertEstimate } from './helpers/fixtures';

const MIGRATIONS = [
  '001_init_schema.ts',
  '002_admin_sessions.ts',
  '003_estimate_access_tokens.ts',
  '004_base_prices_and_email.ts',
  '005_seed_dev_data.ts',
  '006_receipt_sequence.ts',
  '007_email_events_schema_enhancement.ts',
  '008_customer_contact_policy.ts',
  '009_admin_api_indexes.ts',
  '010_admin_memos_content_check.ts',
  '011_admin_must_change_password.ts'
];

const APPLICATION_TABLES = [
  'admin_memos',
  'admin_sessions',
  'admin_users',
  'base_prices',
  'email_events',
  'estimate_access_tokens',
  'estimates',
  'files',
  'quotations',
  'receipt_sequence',
  'status_history'
];

// Migrations 001-011 on a real PostgreSQL: apply, constraints, seed, roll back step by step,
// apply again. The suite starts on an empty schema and leaves it empty.
describeIntegration('migrations 001-011', ({ url }) => {
  const suite = useIsolatedSchema(url, { migrate: false });

  const appliedNames = async (): Promise<string[]> => {
    const rows = await suite().db('knex_migrations').orderBy('id').select('name');
    return rows.map((row: { name: string }) => row.name);
  };

  const tableNames = async (): Promise<string[]> => {
    const result = await suite().db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_name NOT LIKE 'knex\\_%' ORDER BY table_name`,
      [suite().schema]
    );
    return result.rows.map((row: { table_name: string }) => row.table_name);
  };

  const constraintNames = async (): Promise<string[]> => {
    const snapshot = await snapshotSchema(suite().db, suite().schema);
    return snapshot.constraints;
  };

  const indexNames = async (): Promise<string[]> => {
    const result = await suite().db.raw(
      `SELECT indexname FROM pg_indexes WHERE schemaname = ? ORDER BY indexname`,
      [suite().schema]
    );
    return result.rows.map((row: { indexname: string }) => row.indexname);
  };

  describe('applying', () => {
    it('applies all eleven migrations in order', async () => {
      await migrateLatest(suite().db);

      expect(await appliedNames()).toEqual(MIGRATIONS);
    });

    it('creates exactly the application tables', async () => {
      expect(await tableNames()).toEqual(APPLICATION_TABLES);
    });

    it('is a no-op when run again', async () => {
      await migrateLatest(suite().db);

      expect(await appliedNames()).toEqual(MIGRATIONS);
    });

    it('creates the indexes of migrations 007 and 009', async () => {
      const indexes = await indexNames();

      for (const name of [
        'idx_email_events_next_retry',
        'idx_email_events_updated_at',
        'idx_estimates_status_created_at',
        'idx_status_history_estimate_created',
        'idx_admin_memos_estimate_created'
      ]) {
        expect(indexes).toContain(name);
      }
    });
  });

  describe('seed data (migration 005) and the flag of migration 011', () => {
    it('creates the master admin, flagged to change its password', async () => {
      const master = await suite().db('admin_users').where({ id: MASTER_ID }).first();

      expect(master).toMatchObject({
        username: 'master',
        email: 'admin@bridgepath.local',
        role: 'admin',
        is_active: true,
        must_change_password: true
      });
      expect(master.password_hash).toMatch(/^\$2[aby]\$12\$/);
    });

    it('seeds only sample base prices, in valid categories', async () => {
      const prices = await suite().db('base_prices').select('category', 'description', 'base_price');

      expect(prices.length).toBeGreaterThan(0);
      for (const price of prices) {
        expect(price.description).toMatch(/^\[SAMPLE\]/);
        expect(['eyewear', 'shoes', 'golf_products', 'other']).toContain(price.category);
        expect(Number(price.base_price)).toBeGreaterThan(0);
      }
    });

    it('new admins do not have to change their password by default', async () => {
      const id = await insertAdmin(suite().db, { username: 'default-flag' });

      const row = await suite().db('admin_users').where({ id }).first();
      expect(row.must_change_password).toBe(false);
      expect(row.failed_login_attempts).toBe(0);
      expect(row.is_active).toBe(true);

      await suite().db('admin_users').where({ id }).del();
    });
  });

  describe('constraints', () => {
    afterEach(async () => {
      await suite().db.raw('TRUNCATE estimates, email_events, receipt_sequence CASCADE');
      await suite().db('admin_users').whereNot({ id: MASTER_ID }).del();
    });

    const rejects = async (promise: Promise<unknown>, pattern: RegExp) => {
      await expect(promise).rejects.toThrow(pattern);
    };

    describe('contact policy (008): an estimate needs an e-mail or a phone number', () => {
      it('accepts e-mail only', async () => {
        await expect(insertEstimate(suite().db, { customer_email: 'a@example.com', customer_phone: null })).resolves.toBeDefined();
      });

      it('accepts phone only (no e-mail)', async () => {
        await expect(insertEstimate(suite().db, { customer_email: null, customer_phone: '010-1234-5678' })).resolves.toBeDefined();
      });

      it('accepts both', async () => {
        await expect(
          insertEstimate(suite().db, { customer_email: 'a@example.com', customer_phone: '010-1234-5678' })
        ).resolves.toBeDefined();
      });

      it.each([
        ['neither', null, null],
        ['empty e-mail and no phone', '', null],
        ['blank e-mail and blank phone', '   ', '  ']
      ])('rejects %s', async (_name, email, phone) => {
        await rejects(
          insertEstimate(suite().db, { customer_email: email, customer_phone: phone }),
          /estimates_contact_required/
        );
      });

      it('accepts an empty e-mail when there is a phone number', async () => {
        await expect(insertEstimate(suite().db, { customer_email: '', customer_phone: '010-1234-5678' })).resolves.toBeDefined();
      });
    });

    describe('check constraints', () => {
      it('rejects an unknown category', async () => {
        await rejects(insertEstimate(suite().db, { category: 'cars' }), /category/);
      });

      it('rejects a status outside the allowed set, accepts every allowed one', async () => {
        await rejects(insertEstimate(suite().db, { status: 'bogus' }), /status/);

        for (const status of [
          'new_receipt', 'under_review', 'quoted', 'negotiating', 'accepted',
          'completed', 'cancelled', 'rejected', 'on_hold', 'archived'
        ]) {
          await expect(insertEstimate(suite().db, { status })).resolves.toBeDefined();
        }
      });

      it('rejects an unknown admin role', async () => {
        await rejects(suite().db('admin_users').insert({
          username: 'x', email: 'x@test.invalid', password_hash: 'h', role: 'superuser'
        }), /role/);
      });

      it('rejects an unknown e-mail event type and status', async () => {
        await rejects(suite().db('email_events').insert({
          recipient_email: 'a@example.com', email_type: 'spam', subject: 's', body: 'b', idempotency_key: 'k1'
        }), /email_type/);
        await rejects(suite().db('email_events').insert({
          recipient_email: 'a@example.com', email_type: 'receipt', subject: 's', body: 'b', idempotency_key: 'k2', status: 'lost'
        }), /status/);
      });

      it('rejects an unknown file status', async () => {
        const estimate = await insertEstimate(suite().db);

        await rejects(suite().db('files').insert({
          estimate_id: estimate.id, filename: 'a.png', file_size: 1, mime_type: 'image/png',
          s3_key: 'k', file_status: 'maybe'
        }), /file_status/);
      });
    });

    describe('memo length (010): 1 to 5000 characters', () => {
      const insertMemo = async (content: string) => {
        const estimate = await insertEstimate(suite().db);
        return suite().db('admin_memos').insert({
          estimate_id: estimate.id, admin_user_id: MASTER_ID, content
        });
      };

      it('rejects an empty memo and a memo of 5001 characters', async () => {
        await rejects(insertMemo(''), /admin_memos_content_length/);
        await rejects(insertMemo('x'.repeat(5001)), /admin_memos_content_length/);
      });

      it('accepts 1 and 5000 characters (counted in characters, not bytes)', async () => {
        await expect(insertMemo('x')).resolves.toBeDefined();
        await expect(insertMemo('x'.repeat(5000))).resolves.toBeDefined();
        await expect(insertMemo('가'.repeat(5000))).resolves.toBeDefined();
      });
    });

    describe('uniqueness', () => {
      it('receipt_id is unique', async () => {
        await insertEstimate(suite().db, { receipt_id: 'BP20260101900' });

        await rejects(insertEstimate(suite().db, { receipt_id: 'BP20260101900' }), /duplicate key/);
      });

      it('admin username and e-mail are unique', async () => {
        await insertAdmin(suite().db, { username: 'dup' });

        await rejects(insertAdmin(suite().db, { username: 'dup' }), /duplicate key/);
      });

      it('the e-mail idempotency key is unique', async () => {
        const row = {
          recipient_email: 'a@example.com', email_type: 'receipt', subject: 's', body: 'b', idempotency_key: 'same'
        };
        await suite().db('email_events').insert(row);

        await rejects(suite().db('email_events').insert(row), /duplicate key/);
      });

      it('there is one receipt_sequence row per date', async () => {
        await suite().db('receipt_sequence').insert({ receipt_date: '2026-10-13', last_sequence: 1 });

        await rejects(suite().db('receipt_sequence').insert({ receipt_date: '2026-10-13', last_sequence: 2 }), /duplicate key/);
      });
    });

    describe('foreign keys', () => {
      it('a file needs an existing estimate', async () => {
        await rejects(suite().db('files').insert({
          estimate_id: '00000000-0000-0000-0000-00000000dead', filename: 'a.png', file_size: 1,
          mime_type: 'image/png', s3_key: 'k'
        }), /foreign key/);
      });

      it('deleting an estimate removes its files, tokens, memos and history', async () => {
        const db = suite().db;
        const estimate = await insertEstimate(db);
        await db('files').insert({ estimate_id: estimate.id, filename: 'a.png', file_size: 1, mime_type: 'image/png', s3_key: 'k' });
        await db('estimate_access_tokens').insert({ estimate_id: estimate.id, receipt_id: estimate.receipt_id, token: 'hash-1' });
        await db('admin_memos').insert({ estimate_id: estimate.id, admin_user_id: MASTER_ID, content: 'note' });
        await db('status_history').insert({ estimate_id: estimate.id, new_status: 'under_review', changed_by: MASTER_ID });

        await db('estimates').where({ id: estimate.id }).del();

        for (const table of ['files', 'estimate_access_tokens', 'admin_memos', 'status_history']) {
          const count = await db(table).count({ n: '*' }).first();
          expect(Number(count?.n)).toBe(0);
        }
      });

      it('an estimate with an e-mail event cannot be deleted (the event keeps it)', async () => {
        const db = suite().db;
        const estimate = await insertEstimate(db);
        await db('email_events').insert({
          recipient_email: 'a@example.com', email_type: 'receipt', estimate_id: estimate.id,
          subject: 's', body: 'b', idempotency_key: 'receipt-1'
        });

        await rejects(db('estimates').where({ id: estimate.id }).del(), /foreign key/);
      });

      it('deleting an admin removes the sessions of that admin', async () => {
        const db = suite().db;
        const id = await insertAdmin(db, { username: 'gone' });
        await db('admin_sessions').insert({ admin_user_id: id, refresh_token_hash: 'hash-session-1' });

        await db('admin_users').where({ id }).del();

        const count = await db('admin_sessions').count({ n: '*' }).first();
        expect(Number(count?.n)).toBe(0);
      });

      it('an admin who wrote a memo cannot be deleted', async () => {
        const db = suite().db;
        const id = await insertAdmin(db, { username: 'author' });
        const estimate = await insertEstimate(db);
        await db('admin_memos').insert({ estimate_id: estimate.id, admin_user_id: id, content: 'note' });

        await rejects(db('admin_users').where({ id }).del(), /foreign key/);
      });
    });
  });

  describe('rolling back', () => {
    it('step by step: each rollback removes exactly one migration', async () => {
      for (let remaining = MIGRATIONS.length - 1; remaining >= 0; remaining -= 1) {
        await migrateDownOne(suite().db);
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, remaining));
      }

      expect(await tableNames()).toEqual([]);
    });

    it('then applies cleanly again, to the same schema as the first time', async () => {
      const firstRun = await (async () => {
        await migrateLatest(suite().db);
        return snapshotSchema(suite().db, suite().schema);
      })();

      await rollbackAll(suite().db);
      expect(await tableNames()).toEqual([]);
      expect(await constraintNames()).toEqual([]);

      await migrateLatest(suite().db);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(firstRun);
    });

    it('rolling back 011 drops the flag, 010 the memo limit, 008 the contact policy', async () => {
      const db = suite().db;
      const columns = async () =>
        (await db.raw(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'admin_users'`,
          [suite().schema]
        )).rows.map((row: { column_name: string }) => row.column_name);

      expect(await columns()).toContain('must_change_password');
      await migrateDownOne(db); // 011
      expect(await columns()).not.toContain('must_change_password');

      expect((await constraintNames()).join('\n')).toContain('admin_memos_content_length');
      await migrateDownOne(db); // 010
      expect((await constraintNames()).join('\n')).not.toContain('admin_memos_content_length');

      await migrateDownOne(db); // 009
      await migrateDownOne(db); // 008
      expect((await constraintNames()).join('\n')).not.toContain('estimates_contact_required');

      await migrateLatest(db);
      expect(await appliedNames()).toEqual(MIGRATIONS);
    });

    it('008 refuses to roll back while an estimate has no e-mail, and changes nothing', async () => {
      const db = suite().db;
      await insertEstimate(db, { customer_email: null, customer_phone: '010-1234-5678' });

      await migrateDownOne(db); // 011
      await migrateDownOne(db); // 010
      await migrateDownOne(db); // 009
      await expect(migrateDownOne(db)).rejects.toThrow(/customer_email|not-null|null value/i);

      // The failed rollback left the migration recorded and the constraint in place.
      expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 8));
      expect((await constraintNames()).join('\n')).toContain('estimates_contact_required');

      // After the offending row is gone the rollback works.
      await db.raw('TRUNCATE estimates CASCADE');
      await migrateDownOne(db);
      expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 7));

      await migrateLatest(db);
      expect(await appliedNames()).toEqual(MIGRATIONS);
    });
  });
});
