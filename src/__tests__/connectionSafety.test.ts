import {
  assertSchemaName,
  checkTestDatabaseUrl,
  createSchemaName,
  describeDatabaseUrl,
  isLocalHost,
  parseDatabaseUrl,
  requireDatabaseUrl,
  sameDatabase
} from '../db/connectionSafety';

const LOCAL_TEST = 'postgres://tester:SuperSecretDbPw@127.0.0.1:5432/bridgepath_test';

describe('database URL safety checks', () => {
  describe('parseDatabaseUrl', () => {
    it('reads host, port and database from postgres:// and postgresql:// URLs', () => {
      expect(parseDatabaseUrl('postgres://u:p@db.local:6543/app')).toEqual({ host: 'db.local', port: 6543, database: 'app' });
      expect(parseDatabaseUrl('postgresql://u@LOCALHOST/app_test?sslmode=require')).toEqual({
        host: 'localhost',
        port: 5432,
        database: 'app_test'
      });
      expect(parseDatabaseUrl('postgres://u:p@[::1]:5433/x_test')?.host).toBe('[::1]');
    });

    it.each([[''], ['not a url'], ['mysql://u:p@h/db'], ['http://h/db'], ['postgres://h'], ['postgres://h/'], ['postgres:///db']])(
      'rejects %j',
      raw => {
        expect(parseDatabaseUrl(raw)).toBeNull();
      }
    );
  });

  describe('describeDatabaseUrl', () => {
    it('shows host, port and database only, never credentials or options', () => {
      const parsed = parseDatabaseUrl('postgres://user:SuperSecretDbPw@db.local:5432/app?sslmode=require&password=x')!;
      const text = describeDatabaseUrl(parsed);

      expect(text).toBe('db.local:5432/app');
      expect(text).not.toMatch(/user|SuperSecretDbPw|sslmode|password/);
    });
  });

  describe('sameDatabase', () => {
    it('ignores credentials, options, case and the default port', () => {
      expect(sameDatabase('postgres://a:1@Host/db', 'postgresql://b:2@host:5432/db?sslmode=require')).toBe(true);
    });

    it('tells different databases apart', () => {
      expect(sameDatabase('postgres://a@host/db', 'postgres://a@host/db2')).toBe(false);
      expect(sameDatabase('postgres://a@host/db', 'postgres://a@other/db')).toBe(false);
      expect(sameDatabase('postgres://a@host:5433/db', 'postgres://a@host:5432/db')).toBe(false);
    });
  });

  describe('isLocalHost', () => {
    it('accepts only this machine', () => {
      for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
        expect(isLocalHost(host)).toBe(true);
      }
      for (const host of ['db.example.invalid', '10.0.0.5', '0.0.0.0', '127.0.0.2', 'ec2-1-2-3-4.compute-1.amazonaws.com']) {
        expect(isLocalHost(host)).toBe(false);
      }
    });
  });

  describe('requireDatabaseUrl', () => {
    it('returns the value when set', () => {
      expect(requireDatabaseUrl({ DATABASE_URL: 'postgres://h/db' })).toBe('postgres://h/db');
    });

    it('stops with a clear message when missing or blank, and has no default', () => {
      expect(() => requireDatabaseUrl({})).toThrow('DATABASE_URL is not set. Set it explicitly; there is no default database.');
      expect(() => requireDatabaseUrl({ DATABASE_URL: '   ' })).toThrow('DATABASE_URL is not set');
      expect(() => requireDatabaseUrl({}, 'OTHER_URL')).toThrow('OTHER_URL is not set');
    });
  });

  describe('checkTestDatabaseUrl', () => {
    it('accepts a local test database and describes it without credentials', () => {
      const check = checkTestDatabaseUrl({ TEST_DATABASE_URL: LOCAL_TEST });

      expect(check).toEqual({ ok: true, url: LOCAL_TEST, description: '127.0.0.1:5432/bridgepath_test' });
    });

    it.each([
      ['postgres://u:p@localhost/my_test_db'],
      ['postgresql://u:p@[::1]:5433/TEST'],
      ['postgres://u:p@localhost:5432/bridgepath_it_Test']
    ])('accepts %s', url => {
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: url }).ok).toBe(true);
    });

    it('refuses a missing or blank TEST_DATABASE_URL (code NOT_SET)', () => {
      expect(checkTestDatabaseUrl({})).toMatchObject({ ok: false, code: 'NOT_SET' });
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: '  ' })).toMatchObject({ ok: false, code: 'NOT_SET' });
    });

    it('does not fall back to DATABASE_URL', () => {
      const check = checkTestDatabaseUrl({ DATABASE_URL: LOCAL_TEST });
      expect(check).toMatchObject({ ok: false, code: 'NOT_SET' });
    });

    it('refuses invalid URLs (code INVALID_URL)', () => {
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: 'mysql://u:p@127.0.0.1/db_test' })).toMatchObject({
        ok: false,
        code: 'INVALID_URL'
      });
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: 'garbage' })).toMatchObject({ ok: false, code: 'INVALID_URL' });
    });

    it('refuses the same database as DATABASE_URL, whatever the credentials (code SAME_AS_DATABASE_URL)', () => {
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: LOCAL_TEST, DATABASE_URL: LOCAL_TEST })).toMatchObject({
        ok: false,
        code: 'SAME_AS_DATABASE_URL'
      });
      expect(
        checkTestDatabaseUrl({
          TEST_DATABASE_URL: LOCAL_TEST,
          DATABASE_URL: 'postgresql://other:other@127.0.0.1/bridgepath_test?sslmode=disable'
        })
      ).toMatchObject({ ok: false, code: 'SAME_AS_DATABASE_URL' });
    });

    it('allows both variables when they are different databases', () => {
      const check = checkTestDatabaseUrl({
        TEST_DATABASE_URL: LOCAL_TEST,
        DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/bridgepath_dev'
      });
      expect(check.ok).toBe(true);
    });

    it.each([
      ['postgres://u:p@db.example.invalid:5432/app_test'],
      ['postgres://u:p@10.0.0.5/app_test'],
      ['postgres://u:p@ec2-1-2-3-4.compute-1.amazonaws.com/app_test'],
      ['postgres://u:p@0.0.0.0/app_test']
    ])('refuses the remote host in %s (code REMOTE_HOST)', url => {
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: url })).toMatchObject({ ok: false, code: 'REMOTE_HOST' });
    });

    it('refuses a database whose name does not contain "test" (code NOT_A_TEST_DATABASE)', () => {
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1/bridgepath_dev' })).toMatchObject({
        ok: false,
        code: 'NOT_A_TEST_DATABASE'
      });
      expect(checkTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost/production' })).toMatchObject({
        ok: false,
        code: 'NOT_A_TEST_DATABASE'
      });
    });

    it('never puts a password, user name or full URL into any message', () => {
      const urls = [
        'postgres://tester:SuperSecretDbPw@db.example.invalid:5432/app_test',
        'postgres://tester:SuperSecretDbPw@127.0.0.1:5432/production',
        'mysql://tester:SuperSecretDbPw@127.0.0.1/app_test',
        LOCAL_TEST
      ];

      for (const url of urls) {
        const check = checkTestDatabaseUrl({ TEST_DATABASE_URL: url, DATABASE_URL: LOCAL_TEST });
        const text = JSON.stringify(check);

        expect(text).not.toContain('SuperSecretDbPw');
        expect(text).not.toContain('tester');
        if (!check.ok) {
          expect(check.message).not.toContain(url);
        }
      }
    });
  });

  describe('isolated schema names', () => {
    it('are generated as it_ plus 8 hex characters, and differ between runs', () => {
      const names = new Set(Array.from({ length: 50 }, () => createSchemaName()));

      expect(names.size).toBe(50);
      for (const name of names) {
        expect(name).toMatch(/^it_[0-9a-f]{8}$/);
      }
    });

    it('are validated before they can reach SQL', () => {
      expect(assertSchemaName('it_0123abcd')).toBe('it_0123abcd');
      for (const bad of ['public', 'it_', 'it_XYZ', 'it_0123abcd"; DROP SCHEMA public; --', 'IT_0123abcd', '', 'it_0123abcde']) {
        expect(() => assertSchemaName(bad)).toThrow('Invalid test schema name.');
      }
    });
  });
});
