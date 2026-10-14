import { LOCK_DURATION_MS, MAX_FAILED_LOGIN_ATTEMPTS } from '../utils/loginLockout';

interface Queryable {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface FailedLoginResult {
  failed_login_attempts: number;
  locked_until: Date | null;
}

// The counter after one more failure, computed from the row itself (all SET expressions see
// the old row):
//   - a lock that has run out starts counting again from 1;
//   - an active lock is left alone, so late parallel failures neither raise the counter past
//     the limit nor extend the lock;
//   - otherwise the counter goes up by one.
const NEXT_ATTEMPTS = `CASE
  WHEN locked_until IS NOT NULL AND locked_until > $2 THEN COALESCE(failed_login_attempts, 0)
  WHEN locked_until IS NOT NULL THEN 1
  ELSE COALESCE(failed_login_attempts, 0) + 1
END`;

// Counts one failed password attempt in a single UPDATE. The increment happens inside the
// database under the row lock the UPDATE takes, so parallel failures are all counted (a
// read in JavaScript followed by a write of the computed value would lose updates). The
// password comparison must happen before this call, outside any lock.
export async function recordFailedLogin(
  db: Queryable,
  adminId: string,
  now: Date
): Promise<FailedLoginResult> {
  const result = await db.query(
    `UPDATE admin_users
     SET failed_login_attempts = ${NEXT_ATTEMPTS},
         locked_until = CASE
           WHEN locked_until IS NOT NULL AND locked_until > $2 THEN locked_until
           WHEN (${NEXT_ATTEMPTS}) >= $3 THEN $2::timestamptz + ($4 * interval '1 millisecond')
           ELSE NULL
         END
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [adminId, now, MAX_FAILED_LOGIN_ATTEMPTS, LOCK_DURATION_MS]
  );

  const row = result.rows[0];
  return {
    failed_login_attempts: Number(row?.failed_login_attempts ?? 0),
    locked_until: row?.locked_until ? new Date(row.locked_until as string | Date) : null
  };
}
