import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

// bcrypt only uses the first 72 bytes of the input, so longer passwords are rejected
// instead of being silently truncated.
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

export function exceedsBcryptLimit(password: string): boolean {
  return passwordByteLength(password) > BCRYPT_MAX_PASSWORD_BYTES;
}

export async function hashPassword(password: string): Promise<string> {
  if (exceedsBcryptLimit(password)) {
    throw new Error('PASSWORD_TOO_LONG');
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (exceedsBcryptLimit(password)) {
    return false;
  }
  return bcrypt.compare(password, hash);
}
