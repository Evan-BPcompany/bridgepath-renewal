jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import type { Knex } from 'knex';
import {
  MIGRATIONS_DIRECTORY,
  migrateDownOne,
  migrateLatest as migrateEverything,
  rollbackAll,
  snapshotSchema
} from './helpers/database';
import { MASTER_ID, insertAdmin, insertEstimate } from './helpers/fixtures';

// PostgreSQL SQLSTATE codes.
const UNIQUE = '23505'; // unique_violation
const FOREIGN_KEY = '23503'; // foreign_key_violation
const CHECK = '23514'; // check_violation
const NOT_NULL = '23502'; // not_null_violation

// All the migrations; the schema tests below use the first thirteen (see migrateLatest).
const ALL_MIGRATIONS = [
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
  '011_admin_must_change_password.ts',
  '012_customer_type_and_privacy_consent.ts',
  '013_align_estimate_statuses.ts',
  '014_sunglasses_base_prices.ts',
  '015_customer_accounts.ts',
  '016_estimate_customer_link.ts',
  '017_detailed_quotes.ts',
  '018_quote_contact_and_inquiries.ts'
];

// The schema migrations, 001-013. Migration 014 only writes prices (it has its own tests at the end
// of this file), so everything that counts migrations or rolls them back one by one works on these.
const MIGRATIONS = ALL_MIGRATIONS.slice(0, 13);

// "Latest" for the schema tests: applies the migrations up to 013 and no further.
async function migrateLatest(db: Knex): Promise<void> {
  const options = { directory: MIGRATIONS_DIRECTORY, loadExtensions: ['.ts'] };
  for (;;) {
    const [completed] = await db.migrate.list(options);
    if (completed.length >= MIGRATIONS.length) {
      return;
    }
    await db.migrate.up(options);
  }
}

// Compared after a plain (not locale-dependent) sort on both sides.
const APPLICATION_TABLES = [
  'admin_memos',
  'admin_sessions',
  'admin_users',
  'base_prices',
  'email_events',
  'estimate_access_tokens',
  'estimate_status_backup',
  'estimates',
  'files',
  'quotations',
  'receipt_sequence',
  'status_history'
].sort();

// Migrations 001-013 on a real PostgreSQL: apply, constraints, seed, roll back step by step,
// apply again. The suite starts on an empty schema and leaves it empty.
describeIntegration('migrations 001-013', ({ url }) => {
  const suite = useIsolatedSchema(url, { migrate: false });

  const appliedNames = async (): Promise<string[]> => {
    const rows = await suite().db('knex_migrations').orderBy('id').select('name');
    return rows.map((row: { name: string }) => row.name);
  };

  // Applies everything, then rolls back down to the first `count` migrations.
  const migrateTo = async (count: number): Promise<void> => {
    await migrateEverything(suite().db);
    while ((await appliedNames()).length > count) {
      await migrateDownOne(suite().db);
    }
  };

  const tableNames = async (): Promise<string[]> => {
    const result = await suite().db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_name NOT LIKE 'knex\\_%' ORDER BY table_name`,
      [suite().schema]
    );
    return result.rows.map((row: { table_name: string }) => row.table_name).sort();
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
    it('applies all thirteen migrations in order', async () => {
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

    // Checks the PostgreSQL SQLSTATE (and the constraint name when given), never the message
    // text, which depends on the server's lc_messages setting.
    const rejects = async (promise: Promise<unknown>, code: string, constraint?: string) => {
      await expect(promise).rejects.toMatchObject(constraint ? { code, constraint } : { code });
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
          CHECK, 'estimates_contact_required'
        );
      });

      it('accepts an empty e-mail when there is a phone number', async () => {
        await expect(insertEstimate(suite().db, { customer_email: '', customer_phone: '010-1234-5678' })).resolves.toBeDefined();
      });
    });

    describe('check constraints', () => {
      it('rejects an unknown category', async () => {
        await rejects(insertEstimate(suite().db, { category: 'cars' }), CHECK);
      });

      it('rejects a status outside the allowed set, accepts every allowed one', async () => {
        await rejects(insertEstimate(suite().db, { status: 'bogus' }), CHECK);

        for (const status of [
          'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
          'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
        ]) {
          await expect(insertEstimate(suite().db, { status })).resolves.toBeDefined();
        }

        // The statuses retired by migration 013 are not allowed any more.
        for (const retired of ['rejected', 'archived', 'negotiating']) {
          await rejects(insertEstimate(suite().db, { status: retired }), CHECK, 'estimates_status_check');
        }
      });

      it('rejects an unknown admin role', async () => {
        await rejects(suite().db('admin_users').insert({
          username: 'x', email: 'x@test.invalid', password_hash: 'h', role: 'superuser'
        }), CHECK);
      });

      it('rejects an unknown e-mail event type and status', async () => {
        await rejects(suite().db('email_events').insert({
          recipient_email: 'a@example.com', email_type: 'spam', subject: 's', body: 'b', idempotency_key: 'k1'
        }), CHECK);
        await rejects(suite().db('email_events').insert({
          recipient_email: 'a@example.com', email_type: 'receipt', subject: 's', body: 'b', idempotency_key: 'k2', status: 'lost'
        }), CHECK);
      });

      it('rejects an unknown file status', async () => {
        const estimate = await insertEstimate(suite().db);

        await rejects(suite().db('files').insert({
          estimate_id: estimate.id, filename: 'a.png', file_size: 1, mime_type: 'image/png',
          s3_key: 'k', file_status: 'maybe'
        }), CHECK);
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
        await rejects(insertMemo(''), CHECK, 'admin_memos_content_length');
        await rejects(insertMemo('x'.repeat(5001)), CHECK, 'admin_memos_content_length');
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

        await rejects(insertEstimate(suite().db, { receipt_id: 'BP20260101900' }), UNIQUE);
      });

      it('admin username and e-mail are unique', async () => {
        await insertAdmin(suite().db, { username: 'dup' });

        await rejects(insertAdmin(suite().db, { username: 'dup' }), UNIQUE);
      });

      it('the e-mail idempotency key is unique', async () => {
        const row = {
          recipient_email: 'a@example.com', email_type: 'receipt', subject: 's', body: 'b', idempotency_key: 'same'
        };
        await suite().db('email_events').insert(row);

        await rejects(suite().db('email_events').insert(row), UNIQUE);
      });

      it('there is one receipt_sequence row per date', async () => {
        await suite().db('receipt_sequence').insert({ receipt_date: '2026-10-13', last_sequence: 1 });

        // The retry logic keys on this exact constraint name (utils/transactionRetry.ts).
        await rejects(
          suite().db('receipt_sequence').insert({ receipt_date: '2026-10-13', last_sequence: 2 }),
          UNIQUE,
          'receipt_sequence_receipt_date_key'
        );
      });
    });

    describe('customer type and privacy consent (012)', () => {
      const CONSENT_AT = '2026-10-16T01:02:03Z';

      it('new columns are nullable, have no default, and an ordinary insert leaves them NULL', async () => {
        const columns = await suite().db.raw(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = ? AND table_name = 'estimates'
             AND column_name IN ('customer_type', 'privacy_consent_at', 'privacy_consent_version')
           ORDER BY column_name`,
          [suite().schema]
        );
        expect(columns.rows).toEqual([
          { column_name: 'customer_type', data_type: 'character varying', is_nullable: 'YES', column_default: null },
          { column_name: 'privacy_consent_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
          { column_name: 'privacy_consent_version', data_type: 'character varying', is_nullable: 'YES', column_default: null }
        ]);

        const estimate = await insertEstimate(suite().db);
        const row = await suite().db('estimates').where({ id: estimate.id }).first();
        expect(row.customer_type).toBeNull();
        expect(row.privacy_consent_at).toBeNull();
        expect(row.privacy_consent_version).toBeNull();
      });

      it.each(['individual_startup', 'business_brand'])('accepts the customer type %s', async customerType => {
        const estimate = await insertEstimate(suite().db, { customer_type: customerType });
        const row = await suite().db('estimates').where({ id: estimate.id }).first();
        expect(row.customer_type).toBe(customerType);
      });

      it.each(['individual', 'business', 'Individual_Startup', '개인·창업 준비 중', ''])(
        'rejects the customer type %j',
        async customerType => {
          await rejects(
            insertEstimate(suite().db, { customer_type: customerType }),
            CHECK,
            'estimates_customer_type_check'
          );
        }
      );

      it('accepts a consent (time and version together), stored as given', async () => {
        const estimate = await insertEstimate(suite().db, {
          customer_type: 'business_brand',
          privacy_consent_at: CONSENT_AT,
          privacy_consent_version: 'v1'
        });
        const row = await suite().db('estimates').where({ id: estimate.id }).first();
        expect(new Date(row.privacy_consent_at).toISOString()).toBe('2026-10-16T01:02:03.000Z');
        expect(row.privacy_consent_version).toBe('v1');
      });

      it('rejects a consent time without a version, a version without a time, and a blank version', async () => {
        await rejects(
          insertEstimate(suite().db, { privacy_consent_at: CONSENT_AT }),
          CHECK,
          'estimates_privacy_consent_consistent'
        );
        await rejects(
          insertEstimate(suite().db, { privacy_consent_version: 'v1' }),
          CHECK,
          'estimates_privacy_consent_consistent'
        );
        await rejects(
          insertEstimate(suite().db, { privacy_consent_at: CONSENT_AT, privacy_consent_version: '   ' }),
          CHECK,
          'estimates_privacy_consent_consistent'
        );
      });

      it('a customer type without a consent is allowed by the database (the API decides what a request needs)', async () => {
        await expect(insertEstimate(suite().db, { customer_type: 'individual_startup' })).resolves.toBeDefined();
      });

      it('an estimate from before the migration (all NULL) can still be updated', async () => {
        const estimate = await insertEstimate(suite().db);

        await suite().db('estimates').where({ id: estimate.id }).update({ status: 'under_review' });

        const row = await suite().db('estimates').where({ id: estimate.id }).first();
        expect(row.status).toBe('under_review');
        expect(row.customer_type).toBeNull();
      });
    });

    describe('foreign keys', () => {
      it('a file needs an existing estimate', async () => {
        await rejects(suite().db('files').insert({
          estimate_id: '00000000-0000-0000-0000-00000000dead', filename: 'a.png', file_size: 1,
          mime_type: 'image/png', s3_key: 'k'
        }), FOREIGN_KEY);
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

        await rejects(db('estimates').where({ id: estimate.id }).del(), FOREIGN_KEY);
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

        await rejects(db('admin_users').where({ id }).del(), FOREIGN_KEY);
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
      await migrateDownOne(db); // 013 (no estimate is in a status the old set lacks)
      await migrateDownOne(db); // 012 (no estimate holds a customer type or consent here)
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

    describe('012 (customer type and privacy consent)', () => {
      const estimateColumns = async (): Promise<string[]> =>
        (
          await suite().db.raw(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = ? AND table_name = 'estimates' ORDER BY column_name`,
            [suite().schema]
          )
        ).rows.map((row: { column_name: string }) => row.column_name);
      const NEW_COLUMNS = ['customer_type', 'privacy_consent_at', 'privacy_consent_version'];
      const lockState = async (): Promise<number[]> =>
        (await suite().db('knex_migrations_lock').select('is_locked')).map((row: { is_locked: number }) =>
          Number(row.is_locked)
        );
      const clearRecords = () =>
        suite().db('estimates').update({
          customer_type: null,
          privacy_consent_at: null,
          privacy_consent_version: null
        });

      afterEach(async () => {
        await suite().db.raw('TRUNCATE estimates, email_events, receipt_sequence CASCADE');
        await migrateLatest(suite().db);
      });

      it.each([
        ['a customer type and a consent', { customer_type: 'business_brand', privacy_consent_at: '2026-10-16T01:02:03Z', privacy_consent_version: 'v1' }],
        ['a customer type only', { customer_type: 'individual_startup' }]
      ])('refuses to roll back while an estimate holds %s, and changes nothing', async (_name, record) => {
        const db = suite().db;
        const estimate = await insertEstimate(db, record);

        await migrateDownOne(db); // 013 first (nothing blocks it)
        await expect(migrateDownOne(db)).rejects.toThrow(/Refusing to roll back migration 012: 1 estimate\(s\)/);

        // One transaction: still recorded, columns and constraints still there, data intact, lock released.
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 12));
        expect(await estimateColumns()).toEqual(expect.arrayContaining(NEW_COLUMNS));
        const names = (await constraintNames()).join('\n');
        expect(names).toContain('estimates_customer_type_check');
        expect(names).toContain('estimates_privacy_consent_consistent');
        const row = await db('estimates').where({ id: estimate.id }).first();
        expect(row.customer_type).toBe(record.customer_type);
        expect(await lockState()).toEqual([0]);

        // Once the records are cleared on purpose the rollback works.
        await clearRecords();
        await migrateDownOne(db);
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 11));
        expect(await estimateColumns()).not.toEqual(expect.arrayContaining(NEW_COLUMNS));
      });

      it('rolls back when every estimate has NULLs, keeps those estimates, and applies again with NULLs', async () => {
        const db = suite().db;
        const legacy = await insertEstimate(db);

        await migrateDownOne(db); // 013
        await migrateDownOne(db); // 012
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 11));
        const columns = await estimateColumns();
        for (const column of NEW_COLUMNS) {
          expect(columns).not.toContain(column);
        }
        const names = (await constraintNames()).join('\n');
        expect(names).not.toContain('estimates_customer_type_check');
        expect(names).not.toContain('estimates_privacy_consent_consistent');
        expect(await db('estimates').where({ id: legacy.id }).first()).toMatchObject({ receipt_id: legacy.receipt_id });

        await migrateLatest(db);
        expect(await appliedNames()).toEqual(MIGRATIONS);
        const row = await db('estimates').where({ id: legacy.id }).first();
        expect(row.customer_type).toBeNull();
        expect(row.privacy_consent_at).toBeNull();
        expect(row.privacy_consent_version).toBeNull();
      });

      it('a request written while the migration was rolled back (no columns) gets NULLs when applied again', async () => {
        const db = suite().db;
        await migrateDownOne(db); // 013
        await migrateDownOne(db); // 012
        const written = await insertEstimate(db);

        await migrateLatest(db);

        const row = await db('estimates').where({ id: written.id }).first();
        expect(row.customer_type).toBeNull();
      });
    });

    describe('013 (estimate statuses of the PRD)', () => {
      const OLD_STATUSES = [
        'new_receipt', 'under_review', 'quoted', 'negotiating', 'accepted',
        'completed', 'cancelled', 'rejected', 'on_hold', 'archived'
      ];
      const MIGRATED: Record<string, string> = {
        rejected: 'cancelled',
        archived: 'completed',
        negotiating: 'customer_review'
      };
      const OLD_UPDATED_AT = '2026-01-02T03:04:05.000Z';

      // The state right before 013: the old status set, with one estimate per old status.
      const atTwelve = async () => {
        await migrateDownOne(suite().db); // 013
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 12));
      };
      const statusesOf = async (): Promise<Record<string, string>> =>
        Object.fromEntries(
          (await suite().db('estimates').select('receipt_id', 'status')).map((row: { receipt_id: string; status: string }) => [
            row.receipt_id,
            row.status
          ])
        );
      const insertOneOfEach = async () => {
        const ids: Record<string, string> = {};
        for (const status of OLD_STATUSES) {
          const estimate = await insertEstimate(suite().db, {
            receipt_id: `BP20260101${800 + OLD_STATUSES.indexOf(status)}`,
            status
          });
          await suite().db('estimates').where({ id: estimate.id }).update({ updated_at: OLD_UPDATED_AT });
          ids[status] = estimate.id;
        }
        return ids;
      };
      const historyRows = async () =>
        JSON.stringify(await suite().db('status_history').select('*').orderBy('id'));
      const insertHistory = async (estimateId: string) => {
        const rows = [
          [null, 'new_receipt'], ['new_receipt', 'under_review'], ['under_review', 'quoted'],
          ['quoted', 'negotiating'], ['negotiating', 'accepted'], ['accepted', 'completed'],
          ['completed', 'archived'], ['under_review', 'rejected'], ['rejected', 'archived'],
          ['quoted', 'a-value-nobody-knows']
        ];
        for (const [oldStatus, newStatus] of rows) {
          await suite().db('status_history').insert({
            estimate_id: estimateId, old_status: oldStatus, new_status: newStatus, changed_by: MASTER_ID, reason: 'seed'
          });
        }
      };
      const lockState = async (): Promise<number[]> =>
        (await suite().db('knex_migrations_lock').select('is_locked')).map((row: { is_locked: number }) =>
          Number(row.is_locked)
        );
      const rejects = async (promise: Promise<unknown>, code: string, constraint?: string) => {
        await expect(promise).rejects.toMatchObject(constraint ? { code, constraint } : { code });
      };
      const backupExists = async (): Promise<boolean> =>
        (await tableNames()).includes('estimate_status_backup');
      const NEW_STATUSES = [
        'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
        'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
      ];
      // The CHECK constraints on estimates.status (the only ones that mention new_receipt).
      const statusChecks = async (): Promise<Array<{ conname: string; def: string }>> =>
        (
          await suite().db.raw(
            `SELECT conname, pg_get_constraintdef(oid) AS def
             FROM pg_constraint
             WHERE conrelid = 'estimates'::regclass AND contype = 'c'
               AND pg_get_constraintdef(oid) LIKE '%new_receipt%'`
          )
        ).rows;

      afterEach(async () => {
        await suite().db.raw('TRUNCATE estimates, email_events, receipt_sequence CASCADE');
        await migrateLatest(suite().db);
      });

      it('migrates only the three retired statuses, leaves the other seven and every updated_at alone', async () => {
        await atTwelve();
        const ids = await insertOneOfEach();
        const before = await statusesOf();
        expect(Object.values(before).sort()).toEqual([...OLD_STATUSES].sort());

        await migrateLatest(suite().db);

        const after = await suite().db('estimates').select('id', 'status', 'updated_at');
        for (const status of OLD_STATUSES) {
          const row = after.find((r: { id: string }) => r.id === ids[status]);
          expect(row.status).toBe(MIGRATED[status] ?? status);
          // The migration is not a change made by a user.
          expect(new Date(row.updated_at).toISOString()).toBe(OLD_UPDATED_AT);
        }
        expect(await appliedNames()).toEqual(MIGRATIONS);
      });

      it('saves exactly the changed rows in the backup table, with the value they were given', async () => {
        await atTwelve();
        const ids = await insertOneOfEach();

        await migrateLatest(suite().db);

        const backup = await suite().db('estimate_status_backup').select('estimate_id', 'original_status', 'migrated_status');
        expect(
          backup.map((row: { estimate_id: string; original_status: string; migrated_status: string }) => [row.original_status, row.migrated_status]).sort()
        ).toEqual([
          ['archived', 'completed'],
          ['negotiating', 'customer_review'],
          ['rejected', 'cancelled']
        ]);
        expect(new Set(backup.map((row: { estimate_id: string }) => row.estimate_id))).toEqual(
          new Set([ids.rejected, ids.archived, ids.negotiating])
        );
      });

      it('never touches status_history: byte-identical after up, after down and after up again', async () => {
        await atTwelve();
        const ids = await insertOneOfEach();
        await insertHistory(ids.completed);
        await insertHistory(ids.rejected);
        const original = await historyRows();
        const rowCount = (JSON.parse(original) as unknown[]).length;
        expect(rowCount).toBe(20);

        await migrateLatest(suite().db);
        expect(await historyRows()).toBe(original);

        // No entry was turned into a self-transition such as completed -> completed.
        const selfTransitions = await suite().db('status_history').whereRaw('old_status = new_status');
        expect(selfTransitions).toHaveLength(0);
        expect(
          await suite().db('status_history').where({ old_status: 'completed', new_status: 'archived' })
        ).toHaveLength(2);

        await migrateDownOne(suite().db);
        expect(await historyRows()).toBe(original);

        await migrateLatest(suite().db);
        expect(await historyRows()).toBe(original);
      });

      it('rolling back gives rejected, archived and negotiating their original status back, exactly', async () => {
        await atTwelve();
        await insertOneOfEach();
        const original = await statusesOf();
        await migrateLatest(suite().db);

        await migrateDownOne(suite().db);

        expect(await statusesOf()).toEqual(original);
        expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 12));
        expect(await backupExists()).toBe(false);
        // The new CHECK was dropped before the old statuses were restored and the original one is
        // back: exactly one CHECK on the status, named as before, with the original ten statuses.
        const checks = await statusChecks();
        expect(checks).toHaveLength(1);
        expect(checks[0].conname).toBe('estimates_status_check');
        expect(checks[0].def).not.toMatch(/customer_review|info_requested|factory_checking/);
        for (const status of OLD_STATUSES) {
          expect(checks[0].def).toContain(`'${status}'`);
        }
        for (const status of OLD_STATUSES) {
          await expect(insertEstimate(suite().db, { status })).resolves.toBeDefined();
        }
        for (const status of ['info_requested', 'factory_checking', 'customer_review', 'bogus']) {
          await rejects(insertEstimate(suite().db, { status }), CHECK, 'estimates_status_check');
        }
      });

      it('a failure at the end undoes the whole rollback: the dropped CHECK is back and no status was restored', async () => {
        await atTwelve();
        const ids = await insertOneOfEach();
        await migrateLatest(suite().db);
        // A CHECK that lets one stray status in, so that the final verification of down() fails.
        const permissive = `ALTER TABLE estimates ADD CONSTRAINT estimates_status_check CHECK (status IN (${NEW_STATUSES.map(
          status => `'${status}'`
        ).join(', ')}, 'stray'))`;
        await suite().db.raw('ALTER TABLE estimates DROP CONSTRAINT estimates_status_check');
        await suite().db.raw(permissive);
        try {
          await suite().db('estimates').where({ id: ids.accepted }).update({ status: 'stray' });
          const before = await statusesOf();
          const historyBefore = await historyRows();

          await expect(migrateDownOne(suite().db)).rejects.toThrow(/would leave 1 estimate\(s\) with a status/);

          // Everything down() did before the failure was undone, the CHECK it dropped included.
          expect(await appliedNames()).toEqual(MIGRATIONS);
          expect(await statusesOf()).toEqual(before); // rejected/archived/negotiating were not restored
          expect(await historyRows()).toBe(historyBefore);
          const checks = await statusChecks();
          expect(checks).toHaveLength(1);
          expect(checks[0].def).toContain('stray');
          expect(await backupExists()).toBe(true);
          expect(await suite().db('estimate_status_backup')).toHaveLength(3);
          expect(await lockState()).toEqual([0]);
        } finally {
          await suite().db('estimates').where({ status: 'stray' }).update({ status: 'accepted' });
          await suite().db.raw('ALTER TABLE estimates DROP CONSTRAINT estimates_status_check');
          await suite().db.raw(
            `ALTER TABLE estimates ADD CONSTRAINT estimates_status_check CHECK (status IN (${NEW_STATUSES.map(
              status => `'${status}'`
            ).join(', ')}))`
          );
        }
      });

      it('there is exactly one CHECK on the status after applying, and it is the new one', async () => {
        const checks = await statusChecks();

        expect(checks).toHaveLength(1);
        expect(checks[0].conname).toBe('estimates_status_check');
        for (const status of NEW_STATUSES) {
          expect(checks[0].def).toContain(`'${status}'`);
        }
        expect(checks[0].def).not.toMatch(/rejected|archived|negotiating/);
      });

      it.each(['info_requested', 'factory_checking'])(
        'refuses to roll back while an estimate is in %s, and changes nothing',
        async status => {
          await atTwelve();
          const ids = await insertOneOfEach();
          await migrateLatest(suite().db);
          const blocked = await insertEstimate(suite().db, { status });
          const before = await statusesOf();
          const historyBefore = await historyRows();

          await expect(migrateDownOne(suite().db)).rejects.toThrow(
            /Refusing to roll back migration 013: 1 estimate\(s\) are in info_requested or factory_checking/
          );

          // One transaction: nothing changed, the backup is still there, the lock was released.
          expect(await appliedNames()).toEqual(MIGRATIONS);
          expect(await statusesOf()).toEqual(before);
          expect(await historyRows()).toBe(historyBefore);
          expect(await backupExists()).toBe(true);
          expect(await lockState()).toEqual([0]);
          await rejects(insertEstimate(suite().db, { status: 'rejected' }), CHECK, 'estimates_status_check');
          // Refused before anything was changed: the new CHECK was not even dropped for a moment.
          const checks = await statusChecks();
          expect(checks).toHaveLength(1);
          expect(checks[0].def).toContain('info_requested');
          expect(await suite().db('estimate_status_backup')).toHaveLength(3);

          // Once that estimate is moved to another status the rollback works.
          await suite().db('estimates').where({ id: blocked.id }).update({ status: 'under_review' });
          await migrateDownOne(suite().db);
          expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 12));
          expect((await suite().db('estimates').where({ id: ids.rejected }).first()).status).toBe('rejected');
        }
      );

      it('does not overwrite a row that changed after the migration; renames the rest of customer_review', async () => {
        await atTwelve();
        const ids = await insertOneOfEach();
        const second = await insertEstimate(suite().db, { receipt_id: 'BP20260109900', status: 'negotiating' });
        await migrateLatest(suite().db);
        // After up(): a row that was negotiating moves on; a row is created in customer_review and in cancelled.
        await suite().db('estimates').where({ id: ids.negotiating }).update({ status: 'accepted' });
        const created = await insertEstimate(suite().db, { receipt_id: 'BP20260109901', status: 'customer_review' });
        const cancelled = await insertEstimate(suite().db, { receipt_id: 'BP20260109902', status: 'cancelled' });
        // A backed-up row that was edited by hand afterwards.
        await suite().db('estimates').where({ id: ids.rejected }).update({ status: 'on_hold' });

        await migrateDownOne(suite().db);

        const status = async (id: string) => (await suite().db('estimates').where({ id }).first()).status;
        expect(await status(ids.negotiating)).toBe('accepted'); // changed since: left alone
        expect(await status(ids.rejected)).toBe('on_hold'); // changed since: left alone
        expect(await status(ids.archived)).toBe('archived'); // still what up() gave it: restored
        expect(await status(second.id)).toBe('negotiating'); // restored
        expect(await status(created.id)).toBe('negotiating'); // customer_review is negotiating under its old name
        expect(await status(cancelled.id)).toBe('cancelled'); // a valid old status: unchanged
      });

      it('the new CHECK allows exactly the ten statuses of the PRD', async () => {
        for (const status of [
          'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
          'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
        ]) {
          await expect(insertEstimate(suite().db, { status })).resolves.toBeDefined();
        }
        for (const refused of ['rejected', 'archived', 'negotiating', 'bogus', '', 'NEW_RECEIPT']) {
          await rejects(insertEstimate(suite().db, { status: refused }), CHECK, 'estimates_status_check');
        }
        const constraints = (await constraintNames()).join('\n');
        expect(constraints).toContain('estimates_status_check');
        expect(constraints).toContain('estimates_contact_required');
      });

      it('a status change that is still open when the migration starts is waited for, and its result is migrated', async () => {
        const target = await insertEstimate(suite().db, { receipt_id: 'BP20260109800', status: 'under_review' });
        await atTwelve();

        // An admin is changing the status right now (not committed yet).
        const change = await suite().db.transaction();
        change.executionPromise.catch(() => undefined);
        await change('estimates').where({ id: target.id }).update({ status: 'rejected' });

        let finished = false;
        const migrating = migrateLatest(suite().db).then(() => {
          finished = true;
        });
        await new Promise(resolve => setTimeout(resolve, 600));
        expect(finished).toBe(false); // waits for the open change

        await change.commit();
        await migrating;

        expect(finished).toBe(true);
        expect((await suite().db('estimates').where({ id: target.id }).first()).status).toBe('cancelled');
        const backup = await suite().db('estimate_status_backup').where({ estimate_id: target.id }).first();
        expect(backup).toMatchObject({ original_status: 'rejected', migrated_status: 'cancelled' });
      });

      it('applies with no estimates at all, and rolls back and applies again to the same schema', async () => {
        await suite().db.raw('TRUNCATE estimates CASCADE');
        const first = await snapshotSchema(suite().db, suite().schema);

        await migrateDownOne(suite().db);
        expect(await backupExists()).toBe(false);
        await migrateLatest(suite().db);

        expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
        expect(await backupExists()).toBe(true);
        expect(await suite().db('estimate_status_backup')).toHaveLength(0);
      });
    });

    it('008 refuses to roll back while an estimate has no e-mail, and changes nothing', async () => {
      const db = suite().db;
      await insertEstimate(db, { customer_email: null, customer_phone: '010-1234-5678' });

      await migrateDownOne(db); // 013 (the estimate is in new_receipt)
      await migrateDownOne(db); // 012 (the estimate holds no customer type or consent)
      await migrateDownOne(db); // 011
      await migrateDownOne(db); // 010
      await migrateDownOne(db); // 009
      // Intended: down() makes customer_email NOT NULL again, which PostgreSQL refuses while a
      // row holds NULL (not_null_violation on that column). The migration must not be forced
      // through; the operator resolves such rows first.
      await expect(migrateDownOne(db)).rejects.toMatchObject({
        code: NOT_NULL,
        table: 'estimates',
        column: 'customer_email'
      });

      // The failed rollback ran in one transaction: the migration is still recorded, the
      // constraint is still there, the column is still nullable and knex released its lock.
      expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 8));
      expect((await constraintNames()).join('\n')).toContain('estimates_contact_required');
      const column = await db.raw(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'estimates' AND column_name = 'customer_email'`,
        [suite().schema]
      );
      expect(column.rows[0].is_nullable).toBe('YES');
      const lock = await db('knex_migrations_lock').select('is_locked');
      expect(lock.map((row: { is_locked: number }) => Number(row.is_locked))).toEqual([0]);

      // After the offending row is gone the rollback works.
      await db.raw('TRUNCATE estimates CASCADE');
      await migrateDownOne(db);
      expect(await appliedNames()).toEqual(MIGRATIONS.slice(0, 7));

      await migrateLatest(db);
      expect(await appliedNames()).toEqual(MIGRATIONS);
    });
  });

  // Migration 014 writes the first real sunglasses prices (not the structure of the schema).
  describe('014 (the first real sunglasses base prices)', () => {
    // Everything up to and including 014, without 015 and 016 (which have their own tests below).
    const through014 = (): Promise<void> => migrateTo(14);

    const eyewear = async () =>
      suite().db('base_prices').where({ category: 'eyewear' }).orderBy('product_variant').select('product_variant', 'base_price', 'is_active', 'description');

    beforeEach(async () => {
      await through014();
    });

    afterEach(async () => {
      // Back to 001-013 for whatever runs next.
      while ((await appliedNames()).length > MIGRATIONS.length) {
        await migrateDownOne(suite().db);
      }
    });

    it('is applied after 013 by the real "latest"', async () => {
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 14));
    });

    it('writes the five prices, replaces the samples of Plastic and Metal, and switches the Premium sample off', async () => {
      const rows = await eyewear();

      expect(rows.filter(row => row.is_active).map(row => [row.product_variant, Number(row.base_price)])).toEqual([
        ['Acetate Frame', 9810],
        ['Metal Frame', 5190],
        ['Mixed Frame', 8620],
        ['Plastic Frame', 2600],
        ['Wood Frame', 6750]
      ]);
      for (const row of rows.filter(row => row.is_active)) {
        expect(row.description).toMatch(/^Made-in-China\.com 2026-10-20: median of \d+ factory listings, USD [\d.]+ at 1 USD = 1330\.79 KRW/);
      }
      const premium = rows.find(row => row.product_variant === 'Premium Frame');
      expect(premium.is_active).toBe(false);
      expect(premium.description).toMatch(/^\[SAMPLE\]/);
    });

    it('leaves the samples of the other categories alone', async () => {
      const others = await suite().db('base_prices').whereNot({ category: 'eyewear' }).select('description', 'is_active');

      expect(others.length).toBeGreaterThan(0);
      for (const row of others) {
        expect(row.description).toMatch(/^\[SAMPLE\]/);
        expect(row.is_active).toBe(true);
      }
    });

    it('rolls back: its prices are gone and the samples that were not replaced are on again', async () => {
      await migrateDownOne(suite().db);

      expect(await appliedNames()).toEqual(MIGRATIONS);
      const rows = await eyewear();
      expect(rows.some(row => /^Made-in-China/.test(row.description))).toBe(false);
      const premium = rows.find(row => row.product_variant === 'Premium Frame');
      expect(premium.is_active).toBe(true);
    });

    it('applies again after a rollback with the same prices, and does not change the schema', async () => {
      const first = await snapshotSchema(suite().db, suite().schema);
      const prices = (await eyewear()).filter(row => row.is_active).map(row => [row.product_variant, Number(row.base_price)]);

      await migrateDownOne(suite().db);
      await through014();

      expect((await eyewear()).filter(row => row.is_active).map(row => [row.product_variant, Number(row.base_price)])).toEqual(prices);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
    });

    it('can be run twice over its own rows: the prices are replaced, not doubled', async () => {
      await migrateDownOne(suite().db);
      await through014();

      expect(await suite().db('base_prices').where({ category: 'eyewear', is_active: true }).count({ n: '*' }).first()).toMatchObject({ n: '5' });
    });
  });

  // Migration 015: customer accounts (sign-up with an e-mail code, Google/Kakao, sessions).
  describe('015 (customer accounts)', () => {
    const insertCustomer = (email: string, extra: Record<string, unknown> = {}) =>
      suite().db('customers').insert({ email, ...extra }).returning('id');

    beforeEach(async () => {
      await migrateTo(15);
    });

    afterEach(async () => {
      while ((await appliedNames()).length > MIGRATIONS.length) {
        await migrateDownOne(suite().db);
      }
    });

    it('is applied after 014 and creates the four tables', async () => {
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 15));
      const names = await tableNames();
      for (const table of ['customers', 'customer_identities', 'customer_sessions', 'customer_email_codes']) {
        expect(names).toContain(table);
      }
    });

    it('keeps one account per e-mail and refuses an e-mail that is not in lowercase', async () => {
      await insertCustomer('buyer@example.com');

      await expect(insertCustomer('buyer@example.com')).rejects.toMatchObject({ code: UNIQUE });
      await expect(insertCustomer('Buyer2@Example.com')).rejects.toMatchObject({ code: CHECK });
    });

    it('accepts only the two customer types and the two providers', async () => {
      await expect(insertCustomer('a@example.com', { customer_type: 'individual_startup' })).resolves.toBeTruthy();
      await expect(insertCustomer('b@example.com', { customer_type: 'whale' })).rejects.toMatchObject({ code: CHECK });

      const [{ id }] = await insertCustomer('c@example.com');
      await expect(
        suite().db('customer_identities').insert({ customer_id: id, provider: 'naver', provider_user_id: '1' })
      ).rejects.toMatchObject({ code: CHECK });
    });

    it('knows a Google or Kakao user once, and one identity per provider for an account', async () => {
      const [{ id: first }] = await insertCustomer('one@example.com');
      const [{ id: second }] = await insertCustomer('two@example.com');
      await suite().db('customer_identities').insert({ customer_id: first, provider: 'google', provider_user_id: 'g-1' });

      await expect(
        suite().db('customer_identities').insert({ customer_id: second, provider: 'google', provider_user_id: 'g-1' })
      ).rejects.toMatchObject({ code: UNIQUE });
      await expect(
        suite().db('customer_identities').insert({ customer_id: first, provider: 'google', provider_user_id: 'g-2' })
      ).rejects.toMatchObject({ code: UNIQUE });
      await expect(
        suite().db('customer_identities').insert({ customer_id: first, provider: 'kakao', provider_user_id: 'g-1' })
      ).resolves.toBeTruthy();
    });

    it('keeps one code per account and purpose', async () => {
      const [{ id }] = await insertCustomer('code@example.com');
      const row = { customer_id: id, purpose: 'signup', code_hash: 'a'.repeat(64), expires_at: new Date(Date.now() + 60000) };
      await suite().db('customer_email_codes').insert(row);

      await expect(suite().db('customer_email_codes').insert(row)).rejects.toMatchObject({ code: UNIQUE });
      await expect(suite().db('customer_email_codes').insert({ ...row, purpose: 'password_reset' })).resolves.toBeTruthy();
      await expect(suite().db('customer_email_codes').insert({ ...row, purpose: 'other' })).rejects.toMatchObject({ code: CHECK });
    });

    it('removes identities, sessions and codes with the account', async () => {
      const [{ id }] = await insertCustomer('gone@example.com');
      await suite().db('customer_identities').insert({ customer_id: id, provider: 'google', provider_user_id: 'g-9' });
      await suite().db('customer_sessions').insert({ customer_id: id, token_hash: 'b'.repeat(64), expires_at: new Date(Date.now() + 60000) });
      await suite().db('customer_email_codes').insert({
        customer_id: id, purpose: 'signup', code_hash: 'c'.repeat(64), expires_at: new Date(Date.now() + 60000)
      });

      await suite().db('customers').where({ id }).del();

      for (const table of ['customer_identities', 'customer_sessions', 'customer_email_codes']) {
        expect(await suite().db(table).count({ n: '*' }).first()).toMatchObject({ n: '0' });
      }
    });

    it('rolls back to the schema of 014, and applies again to the same schema', async () => {
      const first = await snapshotSchema(suite().db, suite().schema);

      await migrateDownOne(suite().db);
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 14));
      expect(await tableNames()).not.toContain('customers');

      await migrateTo(15);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
    });
  });

  // Migration 016: a request can belong to a signed-in customer and be a detailed quote request.
  describe('016 (estimate: customer and kind of request)', () => {
    beforeEach(async () => {
      await migrateTo(16);
    });

    afterEach(async () => {
      while ((await appliedNames()).length > MIGRATIONS.length) {
        await migrateDownOne(suite().db);
      }
    });

    const newCustomer = async (email: string): Promise<string> => {
      const [row] = await suite().db('customers').insert({ email }).returning('id');
      return row.id;
    };

    it('is applied after 015, and every request so far is a simple one without an account', async () => {
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 16));
      const { id } = await insertEstimate(suite().db);

      expect(await suite().db('estimates').where({ id }).first()).toMatchObject({ request_kind: 'simple', customer_id: null });
    });

    it('accepts only the two kinds', async () => {
      const customer = await newCustomer('kind@example.com');

      await expect(insertEstimate(suite().db, { request_kind: 'premium' })).rejects.toMatchObject({ code: CHECK });
      await expect(insertEstimate(suite().db, { request_kind: 'detailed', customer_id: customer })).resolves.toBeTruthy();
      await expect(insertEstimate(suite().db, { request_kind: 'simple', customer_id: customer })).resolves.toBeTruthy();
    });

    it('refuses a customer that does not exist', async () => {
      await expect(
        insertEstimate(suite().db, { customer_id: '00000000-0000-4000-8000-000000000000' })
      ).rejects.toMatchObject({ code: FOREIGN_KEY });
    });

    it('keeps the request when the account is deleted, without the link, whatever its kind', async () => {
      const customer = await newCustomer('gone@example.com');
      const simple = await insertEstimate(suite().db, { customer_id: customer });
      const detailed = await insertEstimate(suite().db, { request_kind: 'detailed', customer_id: customer });

      await suite().db('customers').where({ id: customer }).del();

      expect(await suite().db('estimates').where({ id: simple.id }).first()).toMatchObject({ customer_id: null, request_kind: 'simple' });
      expect(await suite().db('estimates').where({ id: detailed.id }).first()).toMatchObject({ customer_id: null, request_kind: 'detailed' });
    });

    it('rolls back to the schema of 015, and applies again to the same schema', async () => {
      const first = await snapshotSchema(suite().db, suite().schema);

      await migrateDownOne(suite().db);
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 15));
      expect(await suite().db.raw(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'estimates' AND column_name IN ('customer_id','request_kind')`,
        [suite().schema]
      ).then((r: { rows: unknown[] }) => r.rows)).toEqual([]);

      await migrateTo(16);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
    });
  });

  // Migration 017: the detailed quote (working copy and revisions).
  describe('017 (detailed quotes)', () => {
    beforeEach(async () => {
      await migrateTo(17);
    });

    afterEach(async () => {
      while ((await appliedNames()).length > MIGRATIONS.length) {
        await migrateDownOne(suite().db);
      }
    });

    const newQuote = async (estimateId: string, extra: Record<string, unknown> = {}): Promise<string> => {
      const [row] = await suite().db('detailed_quotes').insert({ estimate_id: estimateId, ...extra }).returning('id');
      return row.id;
    };

    it('is applied after 016 and creates the two tables', async () => {
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 17));
      const names = await tableNames();
      expect(names).toContain('detailed_quotes');
      expect(names).toContain('detailed_quote_revisions');
    });

    it('starts a quote as a copy that was never published and has changes', async () => {
      const { id } = await insertEstimate(suite().db);

      const quote = await suite().db('detailed_quotes').where({ id: await newQuote(id) }).first();

      expect(quote).toMatchObject({ items: [], version: 0, edit_seq: 1, has_unpublished_changes: true, published_at: null, fx_rate: null });
      expect(Number(quote.total_amount)).toBe(0);
    });

    it('keeps one quote per estimate', async () => {
      const { id } = await insertEstimate(suite().db);
      await newQuote(id);

      await expect(newQuote(id)).rejects.toMatchObject({ code: UNIQUE });
    });

    it('keeps the exchange rate and its currency together, and the rate above 0', async () => {
      const a = await insertEstimate(suite().db);
      const b = await insertEstimate(suite().db);
      const c = await insertEstimate(suite().db);

      await expect(newQuote(a.id, { fx_currency: 'USD' })).rejects.toMatchObject({ code: CHECK });
      await expect(newQuote(a.id, { fx_rate: 1330.79 })).rejects.toMatchObject({ code: CHECK });
      await expect(newQuote(a.id, { fx_currency: 'USD', fx_rate: 0 })).rejects.toMatchObject({ code: CHECK });
      await expect(newQuote(b.id, { fx_currency: 'USD', fx_rate: 1330.79 })).resolves.toBeTruthy();
      expect(Number((await suite().db('detailed_quotes').where({ estimate_id: b.id }).first()).fx_rate)).toBe(1330.79);
      await expect(newQuote(c.id)).resolves.toBeTruthy();
    });

    it('refuses a negative total, a negative version and an edit counter below 1', async () => {
      const a = await insertEstimate(suite().db);
      await expect(newQuote(a.id, { total_amount: -1 })).rejects.toMatchObject({ code: CHECK });
      await expect(newQuote(a.id, { version: -1 })).rejects.toMatchObject({ code: CHECK });
      await expect(newQuote(a.id, { edit_seq: 0 })).rejects.toMatchObject({ code: CHECK });
    });

    it('keeps one revision per version, and removes quotes and revisions with the estimate', async () => {
      const { id } = await insertEstimate(suite().db);
      const quoteId = await newQuote(id);
      const revision = { quote_id: quoteId, version: 1, snapshot: JSON.stringify({ total_amount: 1 }) };
      await suite().db('detailed_quote_revisions').insert(revision);

      await expect(suite().db('detailed_quote_revisions').insert(revision)).rejects.toMatchObject({ code: UNIQUE });
      await expect(suite().db('detailed_quote_revisions').insert({ ...revision, version: 0 })).rejects.toMatchObject({ code: CHECK });

      await suite().db('estimates').where({ id }).del();

      for (const table of ['detailed_quotes', 'detailed_quote_revisions']) {
        expect(await suite().db(table).count({ n: '*' }).first()).toMatchObject({ n: '0' });
      }
    });

    it('rolls back to the schema of 016, and applies again to the same schema', async () => {
      const first = await snapshotSchema(suite().db, suite().schema);

      await migrateDownOne(suite().db);
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 16));
      expect(await tableNames()).not.toContain('detailed_quotes');

      await migrateTo(17);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
    });
  });

  // Migration 018: the contact of the staff member on a quote, and the questions and consultation
  // requests of the customer about it.
  describe('018 (quote contact and inquiries)', () => {
    beforeEach(async () => {
      await migrateEverything(suite().db);
    });

    afterEach(async () => {
      while ((await appliedNames()).length > MIGRATIONS.length) {
        await migrateDownOne(suite().db);
      }
    });

    const setup = async (): Promise<{ estimateId: string; customerId: string }> => {
      const [customer] = await suite().db('customers').insert({ email: `c${Math.random().toString(36).slice(2)}@example.com` }).returning('id');
      const { id } = await insertEstimate(suite().db, { customer_id: customer.id });
      return { estimateId: id, customerId: customer.id };
    };
    const inquiry = (estimateId: string, extra: Record<string, unknown> = {}) =>
      suite().db('quote_inquiries').insert({ estimate_id: estimateId, quote_version: 1, kind: 'question', body: '질문', ...extra }).returning('id');
    const handled = { status: 'answered', answer: '답변', handled_at: new Date() };

    it('is the last migration: the contact columns on the quote and the table of inquiries', async () => {
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS);
      expect(await tableNames()).toContain('quote_inquiries');
      const columns = await suite().db.raw(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'detailed_quotes' AND column_name LIKE 'contact_%' ORDER BY 1`,
        [suite().schema]
      );
      expect(columns.rows.map((row: { column_name: string }) => row.column_name)).toEqual(['contact_email', 'contact_name', 'contact_phone']);
    });

    it('starts an inquiry open, and a question needs a text and takes no phone', async () => {
      const { estimateId } = await setup();

      const [{ id }] = await inquiry(estimateId);
      expect(await suite().db('quote_inquiries').where({ id }).first()).toMatchObject({ status: 'open', handled_at: null, answer: null, kind: 'question' });

      await expect(inquiry(estimateId, { body: null })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { phone: '010-1234-5678', status: 'answered', answer: 'x', handled_at: new Date() })).rejects.toMatchObject({ code: CHECK });
    });

    it('needs a phone for a consultation, and takes only the three times', async () => {
      const { estimateId } = await setup();
      const consultation = { kind: 'consultation', body: null };

      await expect(inquiry(estimateId, consultation)).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { ...consultation, phone: '010-1234-5678', preferred_time: 'night' })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { ...consultation, phone: '010-1234-5678', preferred_time: 'weekday_am' })).resolves.toBeTruthy();
    });

    it('refuses a kind, a status and a version that do not exist, and a text of 301 characters', async () => {
      const { estimateId } = await setup();

      await expect(inquiry(estimateId, { kind: 'complaint' })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { status: 'closed' })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { quote_version: 0 })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { body: '가'.repeat(301) })).rejects.toMatchObject({ code: '22001' });
      await expect(inquiry(estimateId, { body: '가'.repeat(300) })).resolves.toBeTruthy();
    });

    it('keeps the status in line with the kind and with the time it was handled', async () => {
      const { estimateId } = await setup();

      // A question is answered, never "done"; a consultation is done, never "answered".
      await expect(inquiry(estimateId, { status: 'done', answer: 'x', handled_at: new Date() })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { kind: 'consultation', body: null, phone: '010-1234-5678', ...handled })).rejects.toMatchObject({ code: CHECK });
      // An answered question has an answer; an open one has no time of handling, a handled one has.
      await expect(inquiry(estimateId, { status: 'answered', answer: null, handled_at: new Date() })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { status: 'answered', answer: 'x', handled_at: null })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, { handled_at: new Date() })).rejects.toMatchObject({ code: CHECK });
      await expect(inquiry(estimateId, handled)).resolves.toBeTruthy();
      await expect(inquiry(estimateId, { kind: 'consultation', body: null, phone: '010-1234-5678', status: 'done', handled_at: new Date() })).resolves.toBeTruthy();
    });

    it('allows one open question and one open consultation per request, and any number of handled ones', async () => {
      const a = await setup();
      const b = await setup();
      const consultation = { kind: 'consultation', body: null, phone: '010-1234-5678' };

      await inquiry(a.estimateId);
      await expect(inquiry(a.estimateId)).rejects.toMatchObject({ code: UNIQUE });
      await expect(inquiry(a.estimateId, consultation)).resolves.toBeTruthy();
      await expect(inquiry(a.estimateId, consultation)).rejects.toMatchObject({ code: UNIQUE });
      await expect(inquiry(b.estimateId)).resolves.toBeTruthy();

      await inquiry(b.estimateId, handled);
      await inquiry(b.estimateId, handled);
      expect(await suite().db('quote_inquiries').where({ estimate_id: b.estimateId }).count({ n: '*' }).first()).toMatchObject({ n: '3' });
    });

    it('removes the inquiries with the request, and keeps them without the link when the account goes', async () => {
      const { estimateId, customerId } = await setup();
      await inquiry(estimateId, { customer_id: customerId });

      await suite().db('customers').where({ id: customerId }).del();
      expect(await suite().db('quote_inquiries').where({ estimate_id: estimateId }).first()).toMatchObject({ customer_id: null });

      await suite().db('estimates').where({ id: estimateId }).del();
      expect(await suite().db('quote_inquiries').count({ n: '*' }).first()).toMatchObject({ n: '0' });
    });

    it('stores the contact of the quote', async () => {
      const { estimateId } = await setup();

      const [row] = await suite().db('detailed_quotes').insert({
        estimate_id: estimateId, contact_name: '김담당', contact_email: 'staff@bridgepath.co.kr', contact_phone: '010-1234-5678'
      }).returning('*');

      expect(row).toMatchObject({ contact_name: '김담당', contact_email: 'staff@bridgepath.co.kr', contact_phone: '010-1234-5678' });
      await expect(
        suite().db('detailed_quotes').insert({ estimate_id: (await setup()).estimateId, contact_name: 'x'.repeat(51) })
      ).rejects.toMatchObject({ code: '22001' });
    });

    it('rolls back to the schema of 017, and applies again to the same schema', async () => {
      const first = await snapshotSchema(suite().db, suite().schema);

      await migrateDownOne(suite().db);
      expect(await appliedNames()).toEqual(ALL_MIGRATIONS.slice(0, 17));
      expect(await tableNames()).not.toContain('quote_inquiries');

      await migrateEverything(suite().db);
      expect(await snapshotSchema(suite().db, suite().schema)).toEqual(first);
    });
  });
});
