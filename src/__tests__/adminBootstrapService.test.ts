import bcrypt from 'bcryptjs';
import {
  BootstrapPool,
  bootstrapAdminPassword,
  findBootstrapTarget,
  validateBootstrapUsername
} from '../services/adminBootstrapService';
import { comparePassword } from '../utils/hash';
import { createFakeDb, ADMIN_ID } from './helpers/adminTestUtils';

const GOOD = 'One-Time-Passw0rd!';
const OLD_HASH = bcrypt.hashSync('previous-secret-1A', 4);

interface Account {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

describe('Admin bootstrap service (mocked database)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let account: Account;
  let revokedSessions: number;

  const pool = (): BootstrapPool => db.pool as unknown as BootstrapPool;
  const statements = () => db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());
  const writes = () =>
    db.state.queries.filter(q => /UPDATE admin_(users|sessions)/.test(q.sql));

  beforeEach(() => {
    db = createFakeDb();
    revokedSessions = 0;
    account = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: OLD_HASH,
      is_active: true,
      must_change_password: true,
      failed_login_attempts: 4,
      locked_until: new Date(Date.now() + 600_000)
    };

    db.state.handler = (sql, params) => {
      if (sql.includes('FROM admin_users WHERE username')) {
        return { rows: params[0] === account.username ? [{ ...account }] : [] };
      }
      if (sql.includes('SET password_hash')) {
        account.password_hash = params[1] as string;
        account.must_change_password = true;
        account.failed_login_attempts = 0;
        account.locked_until = null;
        return { rows: [] };
      }
      if (sql.includes('UPDATE admin_sessions SET is_revoked = true')) {
        revokedSessions += 1;
        return { rows: [], rowCount: 3 };
      }
      return undefined;
    };
  });

  describe('validateBootstrapUsername', () => {
    it('trims and accepts ordinary names', () => {
      expect(validateBootstrapUsername('  master  ')).toEqual({ ok: true, username: 'master' });
    });

    it.each([[''], ['   '], ['a'.repeat(51)], ['bad\u0000name'], ['line\nbreak'], ['esc\u001b[31m']])(
      'rejects %j',
      raw => {
        expect(validateBootstrapUsername(raw).ok).toBe(false);
      }
    );

    it('accepts exactly 50 characters', () => {
      expect(validateBootstrapUsername('a'.repeat(50)).ok).toBe(true);
    });
  });

  describe('findBootstrapTarget (read only)', () => {
    it('returns the account details for an active, flagged account', async () => {
      const target = await findBootstrapTarget(pool(), 'master');

      expect(target).toEqual({ ok: true, account: { username: 'master', email: 'admin@bridgepath.local' } });
      expect(writes()).toHaveLength(0);
      expect(db.state.queries[0].sql).not.toContain('FOR UPDATE');
    });

    it('refuses unknown, already initialized and deactivated accounts', async () => {
      expect(await findBootstrapTarget(pool(), 'ghost')).toEqual({ ok: false, refusal: 'NOT_FOUND' });

      account.must_change_password = false;
      expect(await findBootstrapTarget(pool(), 'master')).toEqual({ ok: false, refusal: 'ALREADY_INITIALIZED' });

      account.must_change_password = true;
      account.is_active = false;
      expect(await findBootstrapTarget(pool(), 'master')).toEqual({ ok: false, refusal: 'ACCOUNT_INACTIVE' });
    });
  });

  describe('bootstrapAdminPassword', () => {
    it('stores a cost-12 bcrypt hash and keeps the account flagged', async () => {
      const result = await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      expect(result).toEqual({ ok: true, username: 'master' });
      expect(account.password_hash).not.toBe(OLD_HASH);
      expect(bcrypt.getRounds(account.password_hash)).toBe(12);
      expect(await comparePassword(GOOD, account.password_hash)).toBe(true);
      expect(account.must_change_password).toBe(true);
    });

    it('clears the failed-login counter and the lock', async () => {
      await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      expect(account.failed_login_attempts).toBe(0);
      expect(account.locked_until).toBeNull();

      const update = db.state.queries.find(q => q.sql.includes('SET password_hash'))!;
      const sql = update.sql.replace(/\s+/g, ' ');
      expect(sql).toContain('must_change_password = true');
      expect(sql).toContain('failed_login_attempts = 0');
      expect(sql).toContain('locked_until = NULL');
    });

    it('revokes the account sessions in the same transaction', async () => {
      await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      expect(revokedSessions).toBe(1);
      const revoke = db.state.queries.find(q => q.sql.includes('UPDATE admin_sessions'))!;
      expect(revoke.params).toEqual([ADMIN_ID]);
    });

    it('uses one transaction and locks the row with SELECT ... FOR UPDATE', async () => {
      await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      const all = statements();
      expect(all[0]).toBe('BEGIN');
      expect(all[1]).toContain('FROM admin_users WHERE username = $1 FOR UPDATE');
      expect(all[all.length - 1]).toBe('COMMIT');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('never returns the password or the hash', async () => {
      const result = await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      const text = JSON.stringify(result);
      expect(text).not.toContain(GOOD);
      expect(text).not.toContain(account.password_hash);
      expect(text).not.toMatch(/\$2[aby]\$/);
    });

    it('does not overwrite an account whose password was already changed', async () => {
      account.must_change_password = false;

      const result = await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD });

      expect(result).toEqual({ ok: false, refusal: 'ALREADY_INITIALIZED' });
      expect(account.password_hash).toBe(OLD_HASH);
      expect(writes()).toHaveLength(0);
      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
    });

    it('refuses unknown and deactivated accounts without writing', async () => {
      expect(await bootstrapAdminPassword(pool(), { username: 'ghost', password: GOOD })).toEqual({
        ok: false,
        refusal: 'NOT_FOUND'
      });

      account.is_active = false;
      expect(await bootstrapAdminPassword(pool(), { username: 'master', password: GOOD })).toEqual({
        ok: false,
        refusal: 'ACCOUNT_INACTIVE'
      });

      expect(writes()).toHaveLength(0);
      expect(account.is_active).toBe(false);
    });

    describe('password rules (12 characters minimum, 72 UTF-8 bytes maximum)', () => {
      it('rejects 73 bytes with PASSWORD_TOO_LONG before touching the database', async () => {
        const result = await bootstrapAdminPassword(pool(), { username: 'master', password: `Aa1${'x'.repeat(70)}` });

        expect(result).toEqual({ ok: false, error: 'PASSWORD_TOO_LONG' });
        expect(db.state.queries).toHaveLength(0);
        expect(db.pool.connect).not.toHaveBeenCalled();
      });

      it('rejects 25 Korean characters (75 bytes) and accepts 72 bytes', async () => {
        const tooLong = await bootstrapAdminPassword(pool(), { username: 'master', password: '가'.repeat(25) });
        expect(tooLong).toEqual({ ok: false, error: 'PASSWORD_TOO_LONG' });

        const exact = `${'가'.repeat(23)}aB1`; // 26 characters, 72 bytes
        const ok = await bootstrapAdminPassword(pool(), { username: 'master', password: exact });
        expect(ok.ok).toBe(true);
        expect(await comparePassword(exact, account.password_hash)).toBe(true);
      });

      it('accepts exactly 72 ASCII bytes and stores the whole password', async () => {
        const exact = `Aa1${'x'.repeat(69)}`;
        expect((await bootstrapAdminPassword(pool(), { username: 'master', password: exact })).ok).toBe(true);
        expect(await comparePassword(`${exact}EXTRA`, account.password_hash)).toBe(false);
      });

      it('requires 12 characters, not 12 bytes', async () => {
        const eleven = await bootstrapAdminPassword(pool(), { username: 'master', password: 'Abcdefghi1!' });
        expect(eleven).toMatchObject({ ok: false, error: 'PASSWORD_POLICY_VIOLATION' });

        const sevenCharsFifteenBytes = await bootstrapAdminPassword(pool(), {
          username: 'master',
          password: '가나다라aA1'
        });
        expect(sevenCharsFifteenBytes).toMatchObject({ ok: false, error: 'PASSWORD_POLICY_VIOLATION' });

        const twelve = await bootstrapAdminPassword(pool(), { username: 'master', password: 'Abcdefghij1!' });
        expect(twelve.ok).toBe(true);
      });

      it('applies the character type, account and default-password rules', async () => {
        const lowOnly = await bootstrapAdminPassword(pool(), { username: 'master', password: 'abcdefghijkl' });
        expect(lowOnly).toMatchObject({ ok: false, error: 'PASSWORD_POLICY_VIOLATION' });

        const sameAsEmail = await bootstrapAdminPassword(pool(), {
          username: 'master',
          password: 'ADMIN@bridgepath.local'
        });
        expect(sameAsEmail).toMatchObject({ ok: false, error: 'PASSWORD_POLICY_VIOLATION' });
        if (!sameAsEmail.ok && 'violations' in sameAsEmail) {
          expect(sameAsEmail.violations).toContain('MATCHES_ACCOUNT_INFO');
        }

        const defaultPassword = await bootstrapAdminPassword(pool(), {
          username: 'master',
          password: 'CHANGE_ME_ON_FIRST_LOGIN'
        });
        if (!defaultPassword.ok && 'violations' in defaultPassword) {
          expect(defaultPassword.violations).toContain('MATCHES_DEFAULT_PASSWORD');
        }
      });

      it('rolls back and writes nothing when the password is rejected', async () => {
        await bootstrapAdminPassword(pool(), { username: 'master', password: 'short' });

        expect(writes()).toHaveLength(0);
        expect(account.password_hash).toBe(OLD_HASH);
        expect(account.failed_login_attempts).toBe(4);
        expect(statements()).toContain('ROLLBACK');
      });
    });

    it('rolls back, releases the connection and rethrows when a statement fails', async () => {
      const original = db.state.handler;
      db.state.handler = (sql, params) => {
        if (sql.includes('UPDATE admin_sessions')) {
          throw Object.assign(new Error('boom'), { code: 'XX000' });
        }
        return original(sql, params);
      };

      await expect(bootstrapAdminPassword(pool(), { username: 'master', password: GOOD })).rejects.toThrow('boom');

      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });
  });
});
