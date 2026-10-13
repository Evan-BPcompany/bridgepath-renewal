import bcrypt from 'bcryptjs';
import { BootstrapCliDeps, MAX_PASSWORD_ATTEMPTS, runBootstrapCli } from '../cli/bootstrapAdminCli';
import type { BootstrapPool } from '../services/adminBootstrapService';
import { comparePassword } from '../utils/hash';
import type { Prompter } from '../utils/terminalPrompt';
import { ADMIN_ID, createFakeDb } from './helpers/adminTestUtils';

const URL_WITH_SECRET = 'postgres://dbuser:SuperSecretDbPw@db.example.invalid:5432/bridgepath';
const GOOD = 'One-Time-Passw0rd!';
const OLD_HASH = bcrypt.hashSync('previous-secret-1A', 4);

interface Question {
  text: string;
  hidden: boolean;
}

describe('admin:bootstrap command flow', () => {
  let db: ReturnType<typeof createFakeDb>;
  let account: Record<string, any>;
  let out: string[];
  let err: string[];
  let questions: Question[];
  let answers: string[];
  let poolCreated: jest.Mock;
  let poolEnd: jest.Mock;
  let prompterClosed: jest.Mock;

  const everything = () => [...out, ...err, ...questions.map(q => q.text)].join('\n');

  const makeDeps = (overrides: Partial<BootstrapCliDeps> = {}): BootstrapCliDeps => ({
    env: { DATABASE_URL: URL_WITH_SECRET },
    isInteractive: true,
    createPrompter: (): Prompter => ({
      ask: async (text, options) => {
        questions.push({ text, hidden: options?.hidden === true });
        const next = answers.shift();
        if (next === undefined) {
          throw new Error('INPUT_CLOSED');
        }
        return next;
      },
      close: prompterClosed
    }),
    createPool: url => {
      poolCreated(url);
      return Object.assign(db.pool as unknown as BootstrapPool, { end: poolEnd });
    },
    write: line => out.push(line),
    writeError: line => err.push(line),
    ...overrides
  });

  beforeEach(() => {
    db = createFakeDb();
    out = [];
    err = [];
    questions = [];
    answers = [];
    poolCreated = jest.fn();
    poolEnd = jest.fn(async () => undefined);
    prompterClosed = jest.fn();

    account = {
      id: ADMIN_ID,
      username: 'master',
      email: 'admin@bridgepath.local',
      password_hash: OLD_HASH,
      is_active: true,
      must_change_password: true,
      failed_login_attempts: 3,
      locked_until: null
    };

    db.state.handler = (sql, params) => {
      if (sql.includes('FROM admin_users') && sql.includes('WHERE username')) {
        return { rows: params[0] === account.username ? [{ ...account }] : [] };
      }
      if (sql.includes('SET password_hash')) {
        account.password_hash = params[1];
        account.must_change_password = true;
        account.failed_login_attempts = 0;
        account.locked_until = null;
        return { rows: [] };
      }
      return undefined;
    };
  });

  const dbWrites = () => db.state.queries.filter(q => /UPDATE admin_(users|sessions)/.test(q.sql));

  describe('refuses to start', () => {
    it('without DATABASE_URL: no prompt, no pool, nothing written', async () => {
      const code = await runBootstrapCli(makeDeps({ env: {} }));

      expect(code).toBe(1);
      expect(err).toEqual(['DATABASE_URL is not set. Aborting; nothing was changed.']);
      expect(questions).toHaveLength(0);
      expect(poolCreated).not.toHaveBeenCalled();
    });

    it('treats a blank DATABASE_URL as missing', async () => {
      expect(await runBootstrapCli(makeDeps({ env: { DATABASE_URL: '   ' } }))).toBe(1);
      expect(poolCreated).not.toHaveBeenCalled();
    });

    it('without an interactive terminal: no prompt, no pool', async () => {
      const code = await runBootstrapCli(makeDeps({ isInteractive: false }));

      expect(code).toBe(1);
      expect(err[0]).toMatch(/interactive terminal/);
      expect(questions).toHaveLength(0);
      expect(poolCreated).not.toHaveBeenCalled();
      expect(everything()).not.toContain('SuperSecretDbPw');
    });
  });

  describe('successful bootstrap', () => {
    beforeEach(() => {
      answers = ['master', GOOD, GOOD];
    });

    it('prints only the username and that it completed', async () => {
      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(0);
      expect(out[out.length - 1]).toBe('Bootstrap completed for admin "master".');
      expect(err).toHaveLength(0);
    });

    it('asks for the username visibly and the password twice, hidden', async () => {
      await runBootstrapCli(makeDeps());

      expect(questions).toEqual([
        { text: 'Admin username: ', hidden: false },
        { text: 'One-time password (hidden): ', hidden: true },
        { text: 'Repeat the password (hidden): ', hidden: true }
      ]);
    });

    it('updates the account: new cost-12 hash, forced change, counters cleared', async () => {
      await runBootstrapCli(makeDeps());

      expect(bcrypt.getRounds(account.password_hash)).toBe(12);
      expect(await comparePassword(GOOD, account.password_hash)).toBe(true);
      expect(account.must_change_password).toBe(true);
      expect(account.failed_login_attempts).toBe(0);
      expect(account.locked_until).toBeNull();
    });

    it('uses a transaction with SELECT ... FOR UPDATE', async () => {
      await runBootstrapCli(makeDeps());

      const statements = db.client.query.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' ').trim());
      expect(statements[0]).toBe('BEGIN');
      expect(statements.some(s => s.includes('FOR UPDATE'))).toBe(true);
      expect(statements[statements.length - 1]).toBe('COMMIT');
    });

    it('never prints the password, its hash or DATABASE_URL', async () => {
      await runBootstrapCli(makeDeps());

      const text = everything();
      expect(text).not.toContain(GOOD);
      expect(text).not.toContain(account.password_hash);
      expect(text).not.toMatch(/\$2[aby]\$/);
      expect(text).not.toContain('SuperSecretDbPw');
      expect(text).not.toContain('db.example.invalid');
    });

    it('passes DATABASE_URL only to the pool and closes everything afterwards', async () => {
      await runBootstrapCli(makeDeps());

      expect(poolCreated).toHaveBeenCalledWith(URL_WITH_SECRET);
      expect(poolEnd).toHaveBeenCalledTimes(1);
      expect(prompterClosed).toHaveBeenCalledTimes(1);
    });

    it('states the password rules, in characters and bytes, before asking', async () => {
      await runBootstrapCli(makeDeps());

      expect(out.join('\n')).toContain('at least 12 characters, at most 72 bytes in UTF-8');
      expect(out.join('\n')).toContain('must be changed at the first login');
    });

    it('trims the username', async () => {
      answers = ['  master  ', GOOD, GOOD];
      expect(await runBootstrapCli(makeDeps())).toBe(0);
    });
  });

  describe('password entry', () => {
    it('asks again when the two entries differ', async () => {
      answers = ['master', GOOD, 'Different-Passw0rd!', GOOD, GOOD];

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(0);
      expect(err).toContain('The two entries do not match.');
      expect(questions.filter(q => q.hidden)).toHaveLength(4);
    });

    it('explains a policy failure without echoing the password, then accepts a good one', async () => {
      answers = ['master', 'short1A', 'short1A', GOOD, GOOD];

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(0);
      expect(err.join('\n')).toContain('shorter than 12 characters');
      expect(everything()).not.toContain('short1A');
    });

    it('reports the 72-byte limit', async () => {
      const tooLong = `Aa1${'x'.repeat(70)}`;
      answers = ['master', tooLong, tooLong, GOOD, GOOD];

      await runBootstrapCli(makeDeps());

      expect(err.join('\n')).toContain('longer than 72 bytes in UTF-8');
      expect(everything()).not.toContain(tooLong);
    });

    it(`gives up after ${MAX_PASSWORD_ATTEMPTS} bad attempts and changes nothing`, async () => {
      answers = ['master', 'a', 'a', 'b', 'b', 'c', 'c', GOOD, GOOD];

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(err[err.length - 1]).toBe('No valid password was entered. Nothing was changed.');
      expect(dbWrites()).toHaveLength(0);
      expect(account.password_hash).toBe(OLD_HASH);
      expect(answers).toEqual([GOOD, GOOD]);
    });

    it('accepts a 12-character Korean password mix and the 72-byte maximum', async () => {
      const exact = `${'가'.repeat(23)}aB1`;
      answers = ['master', exact, exact];

      expect(await runBootstrapCli(makeDeps())).toBe(0);
      expect(await comparePassword(exact, account.password_hash)).toBe(true);
    });
  });

  describe('accounts it must not touch', () => {
    it('stops before asking for a password when the account already changed its password', async () => {
      account.must_change_password = false;
      answers = ['master', GOOD, GOOD];

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(err[0]).toBe(
        '"master" has already changed its password (must_change_password is false). It will not be overwritten. Nothing was changed.'
      );
      expect(questions).toHaveLength(1);
      expect(dbWrites()).toHaveLength(0);
      expect(account.password_hash).toBe(OLD_HASH);
    });

    it('stops for an unknown account', async () => {
      answers = ['ghost'];

      expect(await runBootstrapCli(makeDeps())).toBe(1);
      expect(err[0]).toBe('No admin account named "ghost" exists. Nothing was changed.');
      expect(questions).toHaveLength(1);
      expect(dbWrites()).toHaveLength(0);
    });

    it('stops for a deactivated account', async () => {
      account.is_active = false;
      answers = ['master'];

      expect(await runBootstrapCli(makeDeps())).toBe(1);
      expect(err[0]).toBe('"master" is deactivated. Nothing was changed.');
      expect(dbWrites()).toHaveLength(0);
    });

    it('rejects an invalid username before connecting to the database', async () => {
      answers = ['   '];

      expect(await runBootstrapCli(makeDeps())).toBe(1);
      expect(poolCreated).not.toHaveBeenCalled();
    });

    it('re-checks under the row lock: an account initialized in the meantime is not overwritten', async () => {
      answers = ['master', GOOD, GOOD];
      const original = db.state.handler;
      let lookups = 0;
      db.state.handler = (sql, params) => {
        if (sql.includes('FROM admin_users') && sql.includes('WHERE username')) {
          lookups += 1;
          if (lookups === 2) {
            account.must_change_password = false; // another operator finished first
          }
        }
        return original(sql, params);
      };

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(err[err.length - 1]).toMatch(/has already changed its password/);
      expect(account.password_hash).toBe(OLD_HASH);
      expect(dbWrites()).toHaveLength(0);
    });
  });

  describe('failures', () => {
    it('shows only a short error code when the database cannot be reached, never the URL', async () => {
      answers = ['master', GOOD, GOOD];
      const failure = Object.assign(new Error(`connect failed ${URL_WITH_SECRET}`), { code: 'ECONNREFUSED' });
      db.state.handler = () => {
        throw failure;
      };

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(err.join('\n')).toContain('database error: ECONNREFUSED');
      expect(everything()).not.toContain('SuperSecretDbPw');
      expect(everything()).not.toContain('connect failed');
      expect(poolEnd).toHaveBeenCalled();
    });

    it('does not echo unexpected error messages or odd error codes', async () => {
      answers = ['master', GOOD, GOOD];
      db.state.handler = () => {
        throw Object.assign(new Error(`secret ${GOOD}`), { code: 'not a safe code!' });
      };

      await runBootstrapCli(makeDeps());

      expect(err.join('\n')).toContain('database error: unknown');
      expect(everything()).not.toContain(GOOD);
    });

    it('cancelling (input closed / Ctrl+C) changes nothing and still cleans up', async () => {
      answers = ['master', GOOD];

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(err[err.length - 1]).toBe('Cancelled. Nothing was changed.');
      expect(dbWrites()).toHaveLength(0);
      expect(poolEnd).toHaveBeenCalledTimes(1);
      expect(prompterClosed).toHaveBeenCalledTimes(1);
    });

    it('releases the database connection when the update fails', async () => {
      answers = ['master', GOOD, GOOD];
      const original = db.state.handler;
      db.state.handler = (sql, params) => {
        if (sql.includes('UPDATE admin_sessions')) {
          throw Object.assign(new Error('x'), { code: '40001' });
        }
        return original(sql, params);
      };

      const code = await runBootstrapCli(makeDeps());

      expect(code).toBe(1);
      expect(db.client.release).toHaveBeenCalledTimes(1);
      const statements = db.client.query.mock.calls.map(c => String(c[0]).trim());
      expect(statements).toContain('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
    });
  });
});
