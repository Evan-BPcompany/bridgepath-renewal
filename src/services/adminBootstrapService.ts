import { exceedsBcryptLimit, hashPassword } from '../utils/hash';
import { PasswordViolation, validateNewPassword } from '../utils/passwordPolicy';

// Used by the admin bootstrap command. This module deliberately imports neither the app
// config (which demands JWT_SECRET) nor the logger: the command only needs DATABASE_URL.

export interface BootstrapClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}

export interface BootstrapPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  connect(): Promise<BootstrapClient>;
}

export const USERNAME_MAX_LENGTH = 50;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: string };

export function validateBootstrapUsername(raw: string): UsernameCheck {
  const username = raw.trim();

  if (username === '') {
    return { ok: false, reason: 'The username must not be empty.' };
  }
  if (Array.from(username).length > USERNAME_MAX_LENGTH) {
    return { ok: false, reason: `The username must be at most ${USERNAME_MAX_LENGTH} characters.` };
  }
  if (CONTROL_CHARS.test(username)) {
    return { ok: false, reason: 'The username must not contain control characters.' };
  }

  return { ok: true, username };
}

export type BootstrapRefusal = 'NOT_FOUND' | 'ALREADY_INITIALIZED' | 'ACCOUNT_INACTIVE';

interface AccountRow {
  username: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
}

// Only an existing, active account that is still flagged must_change_password = true may be
// bootstrapped. An account that already changed its password is never overwritten.
function refusalFor(row: AccountRow | undefined): BootstrapRefusal | null {
  if (!row) {
    return 'NOT_FOUND';
  }
  if (row.must_change_password !== true) {
    return 'ALREADY_INITIALIZED';
  }
  if (row.is_active !== true) {
    return 'ACCOUNT_INACTIVE';
  }
  return null;
}

export type BootstrapTarget =
  | { ok: true; account: { username: string; email: string } }
  | { ok: false; refusal: BootstrapRefusal };

// Read-only check done before asking for a password.
export async function findBootstrapTarget(
  pool: BootstrapPool,
  username: string
): Promise<BootstrapTarget> {
  const result = await pool.query(
    `SELECT username, email, is_active, must_change_password
     FROM admin_users WHERE username = $1`,
    [username]
  );

  const row: AccountRow | undefined = result.rows[0];
  const refusal = refusalFor(row);

  if (refusal || !row) {
    return { ok: false, refusal: refusal ?? 'NOT_FOUND' };
  }

  return { ok: true, account: { username: row.username, email: row.email } };
}

export type BootstrapOutcome =
  | { ok: true; username: string }
  | { ok: false; refusal: BootstrapRefusal }
  | { ok: false; error: 'PASSWORD_TOO_LONG' }
  | { ok: false; error: 'PASSWORD_POLICY_VIOLATION'; violations: PasswordViolation[] };

// Sets the one-time password of a flagged account. Everything happens in one transaction
// with the account row locked (SELECT ... FOR UPDATE), and the checks are repeated under
// the lock. The password and its hash are never returned or logged here.
export async function bootstrapAdminPassword(
  pool: BootstrapPool,
  input: { username: string; password: string }
): Promise<BootstrapOutcome> {
  // Longer than bcrypt can use: refuse before touching the database, never truncate.
  if (exceedsBcryptLimit(input.password)) {
    return { ok: false, error: 'PASSWORD_TOO_LONG' };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, username, email, is_active, must_change_password
       FROM admin_users WHERE username = $1 FOR UPDATE`,
      [input.username]
    );

    const row = locked.rows[0];
    const refusal = refusalFor(row);

    if (refusal) {
      await client.query('ROLLBACK');
      return { ok: false, refusal };
    }

    const policy = validateNewPassword(input.password, {
      username: row.username,
      email: row.email
    });

    if (!policy.ok) {
      await client.query('ROLLBACK');
      return policy.code === 'PASSWORD_TOO_LONG'
        ? { ok: false, error: 'PASSWORD_TOO_LONG' }
        : { ok: false, error: 'PASSWORD_POLICY_VIOLATION', violations: policy.violations };
    }

    const hash = await hashPassword(input.password);

    await client.query(
      `UPDATE admin_users
       SET password_hash = $2, must_change_password = true,
           failed_login_attempts = 0, locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, hash]
    );

    // The previous password is no longer trusted, so any session opened with it ends.
    await client.query(
      `UPDATE admin_sessions SET is_revoked = true
       WHERE admin_user_id = $1 AND is_revoked = false`,
      [row.id]
    );

    await client.query('COMMIT');

    return { ok: true, username: row.username };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be unusable; the original error is rethrown below.
    }
    throw err;
  } finally {
    client.release();
  }
}
