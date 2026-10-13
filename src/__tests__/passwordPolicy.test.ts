import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARACTERS,
  characterCount,
  characterTypeCount,
  isTooLong,
  validateNewPassword
} from '../utils/passwordPolicy';
import { passwordByteLength } from '../utils/hash';

const account = { username: 'operator', email: 'ops.team@bridgepath.local' };

const violationsOf = (password: string): string[] => {
  const result = validateNewPassword(password, account);
  return result.ok ? [] : result.code === 'PASSWORD_TOO_LONG' ? ['TOO_LONG'] : result.violations;
};

describe('Password policy: characters and bytes', () => {
  it('states both limits: 12 characters minimum, 72 UTF-8 bytes maximum', () => {
    expect(PASSWORD_MIN_CHARACTERS).toBe(12);
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it('counts characters as code points, not UTF-16 units or bytes', () => {
    expect(characterCount('abc')).toBe(3);
    expect(characterCount('가나다')).toBe(3);
    expect(characterCount('😀😀')).toBe(2);
    expect(passwordByteLength('가나다')).toBe(9);
    expect(passwordByteLength('😀')).toBe(4);
  });

  describe('minimum length is measured in characters', () => {
    it('rejects 11 characters and accepts 12 characters', () => {
      expect(violationsOf('Abcdefghi1!')).toContain('TOO_SHORT'); // 11 characters
      expect(characterCount('Abcdefghi1!')).toBe(11);

      expect(violationsOf('Abcdefghij1!')).toEqual([]); // 12 characters
      expect(characterCount('Abcdefghij1!')).toBe(12);
    });

    it('does not let multi-byte characters satisfy the minimum through their byte size', () => {
      const password = '가나다라aA1'; // 7 characters but 15 bytes (>= 12)
      expect(characterCount(password)).toBe(7);
      expect(passwordByteLength(password)).toBe(15);
      expect(violationsOf(password)).toContain('TOO_SHORT');
    });

    it('accepts 12 Korean characters (36 bytes) when three character types are present', () => {
      const password = '가나다라마바사아자차A1'; // 12 characters
      expect(characterCount(password)).toBe(12);
      expect(passwordByteLength(password)).toBe(32);
      expect(violationsOf(password)).toEqual([]);
    });
  });

  describe('maximum length is measured in UTF-8 bytes and never truncated', () => {
    it('accepts exactly 72 bytes and rejects 73', () => {
      const exact = `Aa1${'x'.repeat(69)}`;
      expect(passwordByteLength(exact)).toBe(72);
      expect(isTooLong(exact)).toBe(false);
      expect(validateNewPassword(exact, account)).toEqual({ ok: true });

      const over = `${exact}x`;
      expect(passwordByteLength(over)).toBe(73);
      expect(validateNewPassword(over, account)).toEqual({ ok: false, code: 'PASSWORD_TOO_LONG' });
    });

    it('applies the byte limit to Korean text: 72 bytes pass, 73 do not, although both are under 72 characters', () => {
      const exact = `${'가'.repeat(23)}aB1`; // 26 characters, 72 bytes
      expect(characterCount(exact)).toBe(26);
      expect(passwordByteLength(exact)).toBe(72);
      expect(validateNewPassword(exact, account)).toEqual({ ok: true });

      const over = `${'가'.repeat(23)}aB12`; // 27 characters, 73 bytes
      expect(passwordByteLength(over)).toBe(73);
      expect(validateNewPassword(over, account)).toEqual({ ok: false, code: 'PASSWORD_TOO_LONG' });
    });

    it('rejects a multi-byte character that straddles the 72-byte boundary', () => {
      const straddle = `Aa1${'x'.repeat(68)}가`; // 71 bytes of ASCII + a 3-byte character = 74
      expect(passwordByteLength(straddle)).toBe(74);
      expect(isTooLong(straddle)).toBe(true);
    });

    it('reports PASSWORD_TOO_LONG before any other violation', () => {
      expect(violationsOf('x'.repeat(100))).toEqual(['TOO_LONG']);
    });
  });

  describe('character types (3 of 4)', () => {
    it('counts lowercase, uppercase, digits and everything else as four types', () => {
      expect(characterTypeCount('abcdef')).toBe(1);
      expect(characterTypeCount('abcDEF')).toBe(2);
      expect(characterTypeCount('abcDEF12')).toBe(3);
      expect(characterTypeCount('abcDEF12!')).toBe(4);
      expect(characterTypeCount('가나다')).toBe(1);
      expect(characterTypeCount('가나다abc12')).toBe(3);
    });

    it('requires at least three types', () => {
      expect(violationsOf('abcdefghij12')).toContain('NOT_ENOUGH_CHARACTER_TYPES');
      expect(violationsOf('ABCDEFGHIJ!!')).toContain('NOT_ENOUGH_CHARACTER_TYPES');
      expect(violationsOf('abcdefgh1234')).toContain('NOT_ENOUGH_CHARACTER_TYPES');
      expect(violationsOf('abcdefGH1234')).toEqual([]);
    });

    it('lets spaces and Hangul count as the "other" type', () => {
      expect(violationsOf('correct horse 9')).toEqual([]);
      expect(violationsOf('가나다라마바사아자차카타')).toContain('NOT_ENOUGH_CHARACTER_TYPES');
    });
  });

  describe('other rules', () => {
    it('rejects control characters', () => {
      expect(violationsOf('Abcdefghij\u00071!')).toContain('CONTAINS_CONTROL_CHARACTERS');
      expect(violationsOf('Abcdefghij\n1!')).toContain('CONTAINS_CONTROL_CHARACTERS');
    });

    it('rejects the username, the email and the email name, ignoring case', () => {
      const strict = { username: 'Operator-Account9', email: 'Ops.Team.Lead@bridgepath.local' };

      for (const candidate of ['operator-account9', 'OPS.TEAM.LEAD@BRIDGEPATH.LOCAL', 'ops.team.lead']) {
        const result = validateNewPassword(candidate, strict);
        expect(result.ok).toBe(false);
        if (!result.ok && result.code === 'PASSWORD_POLICY_VIOLATION') {
          expect(result.violations).toContain('MATCHES_ACCOUNT_INFO');
        }
      }
    });

    it('rejects the seeded default password in any letter case', () => {
      for (const candidate of ['CHANGE_ME_ON_FIRST_LOGIN', 'change_me_on_first_login']) {
        expect(violationsOf(candidate)).toContain('MATCHES_DEFAULT_PASSWORD');
      }
    });

    it('reports every violation at once', () => {
      const violations = violationsOf('abc');
      expect(violations).toEqual(expect.arrayContaining(['TOO_SHORT', 'NOT_ENOUGH_CHARACTER_TYPES']));
    });

    it('does not trim or change the password', () => {
      expect(violationsOf('  Abcdefghij1  ')).toEqual([]);
      expect(characterCount('  Abcdefghij1  ')).toBe(15);
    });
  });
});
