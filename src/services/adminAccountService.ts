import { getPool } from '../config/database';
import { comparePassword, hashPassword } from '../utils/hash';
import { evaluateLockout } from '../utils/loginLockout';
import { recordFailedLogin } from './loginAttempts';
import {
  PasswordViolation,
  isTooLong,
  validateNewPassword
} from '../utils/passwordPolicy';

export type PasswordChangeError =
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_POLICY_VIOLATION'
  | 'ACCOUNT_UNAVAILABLE'
  | 'ACCOUNT_LOCKED'
  | 'INVALID_CURRENT_PASSWORD'
  | 'PASSWORD_SAME_AS_CURRENT';

export type PasswordChangeOutcome =
  | { ok: true }
  | { ok: false; error: PasswordChangeError; violations?: PasswordViolation[] };

// Changes the password of the signed-in admin and revokes every session of that admin
// (the current one included) in the same transaction, so the old tokens stop working
// immediately and a fresh login is required everywhere.
//
// The admin row is locked with FOR UPDATE for the duration (about half a second, two
// bcrypt operations at cost 12). Only that admin's own login is affected.
export async function changeOwnPassword(
  input: { adminId: string; currentPassword: string; newPassword: string },
  now: Date = new Date()
): Promise<PasswordChangeOutcome> {
  // Longer than bcrypt can use: reject before touching the database, never truncate.
  if (isTooLong(input.newPassword)) {
    return { ok: false, error: 'PASSWORD_TOO_LONG' };
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, username, email, password_hash, is_active, failed_login_attempts, locked_until
       FROM admin_users WHERE id = $1 FOR UPDATE`,
      [input.adminId]
    );

    if (locked.rows.length === 0 || !locked.rows[0].is_active) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'ACCOUNT_UNAVAILABLE' };
    }

    const admin = locked.rows[0];
    const lockout = evaluateLockout(admin, now);

    if (lockout.status === 'locked') {
      await client.query('ROLLBACK');
      return { ok: false, error: 'ACCOUNT_LOCKED' };
    }

    // Policy problems are reported before the current password is checked and do not
    // count as a failed attempt.
    const policy = validateNewPassword(input.newPassword, {
      username: admin.username,
      email: admin.email
    });
    if (!policy.ok) {
      await client.query('ROLLBACK');
      return policy.code === 'PASSWORD_TOO_LONG'
        ? { ok: false, error: 'PASSWORD_TOO_LONG' }
        : { ok: false, error: 'PASSWORD_POLICY_VIOLATION', violations: policy.violations };
    }

    const currentMatches = await comparePassword(input.currentPassword, admin.password_hash);

    if (!currentMatches) {
      await recordFailedLogin(client, input.adminId, now);
      await client.query('COMMIT');
      return { ok: false, error: 'INVALID_CURRENT_PASSWORD' };
    }

    if (input.currentPassword === input.newPassword) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'PASSWORD_SAME_AS_CURRENT' };
    }

    const newHash = await hashPassword(input.newPassword);

    await client.query(
      `UPDATE admin_users
       SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL,
           must_change_password = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [input.adminId, newHash]
    );

    await client.query(
      `UPDATE admin_sessions SET is_revoked = true
       WHERE admin_user_id = $1 AND is_revoked = false`,
      [input.adminId]
    );

    await client.query('COMMIT');
    return { ok: true };
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
