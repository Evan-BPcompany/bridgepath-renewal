import {
  CODE_LENGTH,
  checkPassword,
  codesMatch,
  generateCode,
  hashCode,
  hashSessionToken,
  isCodeFormat,
  isSessionTokenFormat,
  newSessionToken,
  normalizeEmail,
  safeNextPath,
  validateProfile
} from '../utils/customerAccount';

describe('normalizeEmail', () => {
  it('trims and lowercases, so one address is one account', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });

  it.each([undefined, null, 5, '', '   ', 'no-at-sign', 'a@b', 'a b@c.com', 'a\n@b.com',`${'x'.repeat(100)}@e.com`])(
    'refuses %p',
    value => {
      expect(normalizeEmail(value)).toBeUndefined();
    }
  );
});

describe('checkPassword', () => {
  it('accepts 8 characters with a letter and a digit', () => {
    expect(checkPassword('abcdefg1')).toBeUndefined();
    expect(checkPassword('비밀번호입니다1234')).toBeUndefined();
  });

  it('says what is wrong', () => {
    expect(checkPassword(undefined)).toMatchObject({ field: 'password', message: 'is required' });
    expect(checkPassword('')).toMatchObject({ message: 'is required' });
    expect(checkPassword('abc1')).toMatchObject({ message: expect.stringContaining('at least 8') });
    expect(checkPassword('abcdefgh')).toMatchObject({ message: 'must contain a letter and a digit' });
    expect(checkPassword('12345678')).toMatchObject({ message: 'must contain a letter and a digit' });
    expect(checkPassword('abcdefg1\u0000')).toMatchObject({ message: expect.stringContaining('control') });
  });

  it('refuses what bcrypt would cut (more than 72 bytes)', () => {
    expect(checkPassword(`a1${'x'.repeat(70)}`)).toBeUndefined();
    expect(checkPassword(`a1${'x'.repeat(71)}`)).toMatchObject({ message: expect.stringContaining('72 bytes') });
    // 25 Korean letters are 75 bytes.
    expect(checkPassword(`${'가'.repeat(25)}1`)).toMatchObject({ message: expect.stringContaining('72 bytes') });
  });

  it('refuses the e-mail address or its first part as the password', () => {
    expect(checkPassword('buyer1234', 'buyer1234@example.com')).toMatchObject({ message: 'must not be the e-mail address' });
    expect(checkPassword('Buyer1234@Example.com'.toLowerCase(), 'buyer1234@example.com')).toMatchObject({
      message: 'must not be the e-mail address'
    });
  });
});

describe('validateProfile', () => {
  it('needs a name for a sign-up, and cleans the rest', () => {
    expect(validateProfile({ name: ' Kim ', phone: '010-1234-5678', company_name: ' ACME ', customer_type: 'business_brand' }, { nameRequired: true })).toEqual({
      valid: true,
      value: { name: 'Kim', phone: '010-1234-5678', company_name: 'ACME', customer_type: 'business_brand' }
    });
    expect(validateProfile({}, { nameRequired: true })).toEqual({
      valid: false,
      errors: [{ field: 'name', message: 'is required' }]
    });
    expect(validateProfile({}, { nameRequired: false })).toMatchObject({ valid: true });
  });

  it('refuses what the estimate form refuses', () => {
    const result = validateProfile(
      { name: 'x'.repeat(101), phone: 'call me', company_name: 7, customer_type: 'whale' },
      { nameRequired: true }
    );

    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.errors.map(e => e.field).sort()).toEqual(['company_name', 'customer_type', 'name', 'phone']);
  });

  it('refuses control characters', () => {
    expect(validateProfile({ name: 'Kim\u0007' }, { nameRequired: true })).toMatchObject({ valid: false });
  });
});

describe('the e-mail code', () => {
  it('is 6 digits, with leading zeros kept', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode()).toMatch(new RegExp(`^[0-9]{${CODE_LENGTH}}$`));
    }
    expect(isCodeFormat('012345')).toBe(true);
    expect(isCodeFormat('12345')).toBe(false);
    expect(isCodeFormat('1234567')).toBe(false);
    expect(isCodeFormat('12345a')).toBe(false);
    expect(isCodeFormat(123456)).toBe(false);
  });

  it('is stored as a hash bound to the account and the purpose', () => {
    const hash = hashCode('123456', 'customer-1', 'signup');

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('123456');
    expect(codesMatch(hash, hashCode('123456', 'customer-1', 'signup'))).toBe(true);
    expect(codesMatch(hash, hashCode('123457', 'customer-1', 'signup'))).toBe(false);
    expect(codesMatch(hash, hashCode('123456', 'customer-2', 'signup'))).toBe(false);
    expect(codesMatch(hash, hashCode('123456', 'customer-1', 'password_reset'))).toBe(false);
    expect(codesMatch(hash, 'not-hex')).toBe(false);
  });
});

describe('session tokens', () => {
  it('are random, 64 hex characters, and only their hash is kept', () => {
    const a = newSessionToken();
    const b = newSessionToken();

    expect(a.token).not.toBe(b.token);
    expect(isSessionTokenFormat(a.token)).toBe(true);
    expect(a.hash).toBe(hashSessionToken(a.token));
    expect(a.hash).not.toBe(a.token);
    expect(isSessionTokenFormat('abc')).toBe(false);
    expect(isSessionTokenFormat(undefined)).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps a page of this site, with its query', () => {
    expect(safeNextPath('/sunglasses-estimate.html')).toBe('/sunglasses-estimate.html');
    expect(safeNextPath('/estimate.html?step=3#top')).toBe('/estimate.html?step=3#top');
  });

  it.each([
    'https://evil.example/',
    '//evil.example/',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'evil.html',
    '/path\nwith-newline',
    '/' + 'a'.repeat(400),
    '',
    undefined,
    ['/a'],
    42
  ])('falls back for %p', value => {
    expect(safeNextPath(value)).toBe('/');
    expect(safeNextPath(value, '/index.html')).toBe('/index.html');
  });
});
