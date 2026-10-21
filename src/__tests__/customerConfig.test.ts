import { config, parseBaseUrl, parseOAuthProvider } from '../config/env';

describe('parseBaseUrl', () => {
  it('uses the fallback when nothing is set, and returns the origin without a trailing slash', () => {
    expect(parseBaseUrl('X', undefined, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseBaseUrl('X', '  ', 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseBaseUrl('X', 'https://www.example.com/', 'http://localhost:3000')).toBe('https://www.example.com');
    expect(parseBaseUrl('X', 'https://api.example.com:8443', 'http://localhost:3000')).toBe('https://api.example.com:8443');
  });

  it.each(['not a url', 'ftp://example.com', 'javascript:alert(1)', 'https://example.com/app', 'https://example.com/?a=1', 'https://example.com/#x'])(
    'refuses %s',
    value => {
      expect(() => parseBaseUrl('FRONTEND_BASE_URL', value, 'http://localhost:3000')).toThrow(/FRONTEND_BASE_URL must be/);
    }
  );
});

describe('parseOAuthProvider', () => {
  it('is off without a client id', () => {
    expect(parseOAuthProvider('ID', 'SECRET', {}, true)).toBeUndefined();
    expect(parseOAuthProvider('ID', 'SECRET', { ID: '  ' }, true)).toBeUndefined();
  });

  it('is on with an id, and needs the secret only where asked', () => {
    expect(parseOAuthProvider('ID', 'SECRET', { ID: 'abc', SECRET: 'shh' }, true)).toEqual({ clientId: 'abc', clientSecret: 'shh' });
    expect(parseOAuthProvider('ID', 'SECRET', { ID: 'abc' }, false)).toEqual({ clientId: 'abc', clientSecret: undefined });
    expect(() => parseOAuthProvider('ID', 'SECRET', { ID: 'abc' }, true)).toThrow('SECRET is required when ID is set');
  });
});

describe('the running config for customer accounts', () => {
  it('has addresses for the pages and the API, and no provider switched on by default', () => {
    expect(config.frontendBaseUrl).toMatch(/^https?:\/\/[^/]+$/);
    expect(config.publicApiUrl).toMatch(/^https?:\/\/[^/]+$/);
    expect(Object.keys(config.oauth).sort()).toEqual(['google', 'kakao']);
  });
});
