import { BCRYPT_MAX_PASSWORD_BYTES, passwordByteLength } from './hash';

// A new password needs at least 12 characters (Unicode code points) AND at most 72 bytes
// in UTF-8. The two limits are different units: 12 Korean characters are 36 bytes, while
// 72 bytes allow only 24 Korean characters. bcrypt ignores everything after byte 72, so
// longer passwords are rejected instead of being cut.
export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_BYTES = BCRYPT_MAX_PASSWORD_BYTES;
export const PASSWORD_MIN_CHARACTER_TYPES = 3;
export const DEFAULT_ADMIN_PASSWORD = 'CHANGE_ME_ON_FIRST_LOGIN';

export type PasswordViolation =
  | 'TOO_SHORT'
  | 'NOT_ENOUGH_CHARACTER_TYPES'
  | 'CONTAINS_CONTROL_CHARACTERS'
  | 'MATCHES_ACCOUNT_INFO'
  | 'MATCHES_DEFAULT_PASSWORD';

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; code: 'PASSWORD_TOO_LONG' }
  | { ok: false; code: 'PASSWORD_POLICY_VIOLATION'; violations: PasswordViolation[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function characterCount(password: string): number {
  return Array.from(password).length;
}

export function isTooLong(password: string): boolean {
  return passwordByteLength(password) > PASSWORD_MAX_BYTES;
}

// Four types: lowercase, uppercase, digit, and everything else (symbols, spaces, Hangul...).
export function characterTypeCount(password: string): number {
  let types = 0;
  if (/[a-z]/.test(password)) types += 1;
  if (/[A-Z]/.test(password)) types += 1;
  if (/[0-9]/.test(password)) types += 1;
  if (/[^A-Za-z0-9]/.test(password)) types += 1;
  return types;
}

export function validateNewPassword(
  password: string,
  account: { username: string; email: string }
): PasswordPolicyResult {
  if (isTooLong(password)) {
    return { ok: false, code: 'PASSWORD_TOO_LONG' };
  }

  const violations: PasswordViolation[] = [];

  if (characterCount(password) < PASSWORD_MIN_CHARACTERS) {
    violations.push('TOO_SHORT');
  }

  if (characterTypeCount(password) < PASSWORD_MIN_CHARACTER_TYPES) {
    violations.push('NOT_ENOUGH_CHARACTER_TYPES');
  }

  if (CONTROL_CHARS.test(password)) {
    violations.push('CONTAINS_CONTROL_CHARACTERS');
  }

  const lowered = password.toLowerCase();
  const email = account.email.toLowerCase();
  const accountValues = [account.username.toLowerCase(), email, email.split('@')[0]];
  if (accountValues.includes(lowered)) {
    violations.push('MATCHES_ACCOUNT_INFO');
  }

  if (lowered === DEFAULT_ADMIN_PASSWORD.toLowerCase()) {
    violations.push('MATCHES_DEFAULT_PASSWORD');
  }

  if (violations.length > 0) {
    return { ok: false, code: 'PASSWORD_POLICY_VIOLATION', violations };
  }

  return { ok: true };
}
