import {
  BCRYPT_MAX_PASSWORD_BYTES,
  comparePassword,
  exceedsBcryptLimit,
  hashPassword,
  passwordByteLength
} from '../utils/hash';

describe('Password byte limit (bcrypt 72 bytes, no truncation)', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(BCRYPT_MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordByteLength('a'.repeat(72))).toBe(72);
    expect(passwordByteLength('가'.repeat(24))).toBe(72);
    expect(passwordByteLength('가'.repeat(25))).toBe(75);
  });

  it('flags only passwords above 72 bytes', () => {
    expect(exceedsBcryptLimit('a'.repeat(72))).toBe(false);
    expect(exceedsBcryptLimit('a'.repeat(73))).toBe(true);
    expect(exceedsBcryptLimit('가'.repeat(24))).toBe(false);
    expect(exceedsBcryptLimit('가'.repeat(25))).toBe(true);
    expect(exceedsBcryptLimit(`${'a'.repeat(71)}가`)).toBe(true);
  });

  it('hashes and verifies a password of exactly 72 bytes', async () => {
    const password = 'a'.repeat(72);
    const hash = await hashPassword(password);
    expect(await comparePassword(password, hash)).toBe(true);
  });

  it('hashes and verifies 24 Korean characters (72 bytes)', async () => {
    const password = '가'.repeat(24);
    const hash = await hashPassword(password);
    expect(await comparePassword(password, hash)).toBe(true);
  });

  it('refuses to hash 73 bytes instead of truncating', async () => {
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow('PASSWORD_TOO_LONG');
    await expect(hashPassword('가'.repeat(25))).rejects.toThrow('PASSWORD_TOO_LONG');
    await expect(hashPassword(`${'a'.repeat(71)}가`)).rejects.toThrow('PASSWORD_TOO_LONG');
  });

  it('never matches a longer password that shares the first 72 bytes', async () => {
    const stored = 'a'.repeat(72);
    const hash = await hashPassword(stored);

    // bcrypt alone would accept this because it ignores everything after byte 72.
    expect(await comparePassword(`${stored}EXTRA`, hash)).toBe(false);
  });
});
