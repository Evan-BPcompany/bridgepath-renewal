// Shared account-lockout rules for the admin login and the password change endpoint:
// 5 consecutive failures lock the account for 15 minutes, and a lock that has expired
// starts counting from zero again.

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface LockoutRow {
  failed_login_attempts: number | null;
  locked_until: Date | string | null;
}

export type LockoutState =
  | { status: 'ok'; attempts: number }
  | { status: 'locked'; until: Date }
  | { status: 'expired'; attempts: 0 };

export function evaluateLockout(row: LockoutRow, now: Date): LockoutState {
  if (row.locked_until === null || row.locked_until === undefined) {
    return { status: 'ok', attempts: row.failed_login_attempts ?? 0 };
  }

  const until = new Date(row.locked_until);

  if (until.getTime() > now.getTime()) {
    return { status: 'locked', until };
  }

  return { status: 'expired', attempts: 0 };
}

export interface FailureState {
  failed_login_attempts: number;
  locked_until: Date | null;
}

export function nextFailureState(attemptsBefore: number, now: Date): FailureState {
  const attempts = attemptsBefore + 1;

  return {
    failed_login_attempts: attempts,
    locked_until:
      attempts >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS) : null
  };
}
