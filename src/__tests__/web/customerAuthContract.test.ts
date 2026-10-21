import fs from 'fs';
import path from 'path';
import { checkPassword as serverCheckPassword, normalizeEmail as serverNormalizeEmail, safeNextPath } from '../../utils/customerAccount';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (name: string): string => fs.readFileSync(path.join(ROOT, name), 'utf8');
const withoutComments = (text: string): string => text.replace(/^\s*\/\/.*$/gm, '');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../../../config.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Auth = require('../../../customer-auth.js');

afterAll(() => {
  delete (globalThis as { BridgePathAuth?: unknown }).BridgePathAuth;
  delete (globalThis as { BridgePathConfig?: unknown }).BridgePathConfig;
});

describe('login.html', () => {
  const html = read('login.html');

  it('loads config.js, then the logic, then the page script, and its one new stylesheet', () => {
    expect([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1])).toEqual([
      'config.js',
      'customer-auth.js',
      'customer-auth-page.js'
    ]);
    expect(html).toContain('<link rel="stylesheet" href="customer-auth.css">');
    for (const file of ['config.js', 'customer-auth.js', 'customer-auth-page.js', 'customer-auth.css']) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }
  });

  it('keeps every id once, and has the six steps', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...html.matchAll(/data-step="([^"]+)"/g)].map(match => match[1])).toEqual([
      'login', 'signup', 'code', 'reset-request', 'reset', 'consent'
    ]);
  });

  it('has no inline script or handler, and asks not to be indexed', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('uses the right autocomplete hints for password managers, and password fields only for passwords', () => {
    expect(html).toMatch(/id="loginPassword" type="password" autocomplete="current-password"/);
    expect(html).toMatch(/id="signupPassword" type="password" autocomplete="new-password"/);
    expect(html).toMatch(/id="resetPassword" type="password" autocomplete="new-password"/);
    expect(html).toMatch(/autocomplete="one-time-code"/);
    expect([...html.matchAll(/type="password"/g)]).toHaveLength(3);
  });

  it('links the privacy consent text where the consent is asked, in a new tab without a back reference', () => {
    expect([...html.matchAll(/<a href="privacy-consent\.html" target="_blank" rel="noopener">/g)]).toHaveLength(2);
  });

  it('is reachable from the home page', () => {
    expect(read('index.html')).toContain('href="login.html"');
  });
});

describe('the scripts of the account page', () => {
  const FILES = ['customer-auth.js', 'customer-auth-page.js'];

  it.each(FILES)('%s builds no markup from strings and runs no string as code', file => {
    expect(withoutComments(read(file))).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setTimeout\(\s*['"`]/);
  });

  it.each(FILES)('%s keeps nothing in the browser and prints nothing', file => {
    expect(withoutComments(read(file))).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|alert\(|confirm\(|prompt\(/);
  });

  it('customer-auth.js sends only to /api/customers, with the cookie, and never handles a token', () => {
    const code = withoutComments(read('customer-auth.js'));

    expect((code.match(/doFetch\(/g) || []).length).toBe(1);
    expect(code).toContain("apiBase() + '/api/customers' + path");
    expect(code).toContain("credentials: 'include'");
    expect(code).not.toMatch(/XMLHttpRequest|sendBeacon|WebSocket|Authorization|Bearer|access_token|session_token|bp_session/i);
  });

  it('customer-auth-page.js does not fetch by itself, and puts text on the page only with textContent', () => {
    const code = withoutComments(read('customer-auth-page.js'));

    expect(code).not.toMatch(/fetch\(|XMLHttpRequest/);
    expect(code).toContain('.textContent =');
    expect(code).not.toMatch(/\.(value|href|src)\s*=\s*[^;]*(body|result)\./);
  });

  it('config.js is not changed by the account page: still its four settings', () => {
    expect(Object.keys(config).sort()).toEqual(['API_BASE', 'PRIVACY_CONSENT_URL', 'PRIVACY_CONSENT_VERSION', 'REQUEST_TIMEOUT_MS']);
  });
});

// The page checks the same rules as the server, so a visitor is not sent to the server for nothing.
describe('customer-auth.js against the rules of the server', () => {
  const PASSWORDS = [
    'abcdefg1', 'abcdefg', 'abcdefgh', '12345678', 'abc1', '', 'a1'.repeat(36), `a1${'x'.repeat(70)}`, `a1${'x'.repeat(71)}`,
    '비밀번호입니다1234', '가'.repeat(25) + '1', '한글만입니다요요', 'Passw0rd!', '  abcdefg1', 'abcdefg1\u0000'
  ];

  it.each(PASSWORDS)('agrees with the server about the password %j', password => {
    const server = serverCheckPassword(password, 'buyer@example.com');
    expect(Auth.checkPassword(password, 'buyer@example.com') === null).toBe(server === undefined);
  });

  it('agrees about a password that is the e-mail or its first part', () => {
    for (const password of ['buyer1234', 'buyer1234@example.com']) {
      expect(Auth.checkPassword(password, 'Buyer1234@Example.com') === null).toBe(
        serverCheckPassword(password, 'buyer1234@example.com') === undefined
      );
    }
  });

  it.each(['buyer@example.com', ' Buyer@Example.COM ', 'nope', '', 'a@b', 'a b@c.com', `${'x'.repeat(100)}@e.com`])(
    'agrees with the server about the e-mail %j',
    email => {
      expect(Auth.checkEmail(email) === null).toBe(serverNormalizeEmail(email) !== undefined);
      if (serverNormalizeEmail(email)) {
        expect(Auth.normalizeEmail(email)).toBe(serverNormalizeEmail(email));
      }
    }
  );

  it.each(['/estimate.html', '/a?b=c#d', 'https://evil.example/', '//evil.example', '/\\evil', 'evil', '', undefined, '/a\nb', '/' + 'a'.repeat(400)])(
    'agrees with the server about the next address %j',
    next => {
      expect(Auth.safeNext(next)).toBe(safeNextPath(next));
    }
  );

  it('counts bytes like the server: the limit is 72 bytes, so about 24 Korean letters', () => {
    expect(Auth.byteLength('abc')).toBe(3);
    expect(Auth.byteLength('가')).toBe(3);
    expect(Auth.byteLength('😀')).toBe(4);
    expect(Auth.checkPassword('가'.repeat(24) + '1')).toBe('password_long');
    expect(Auth.checkPassword('가'.repeat(23) + '1')).toBeNull();
  });

  it('knows a message for every code the server can answer with', () => {
    const codes = [
      'EMAIL_TAKEN', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'EMAIL_NOT_VERIFIED', 'INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS',
      'CODE_TOO_SOON', 'EMAIL_UNAVAILABLE', 'PRIVACY_CONSENT_NOT_CONFIGURED', 'RATE_LIMITED', 'VALIDATION_ERROR', 'CUSTOMER_AUTH_REQUIRED'
    ];
    for (const code of codes) {
      expect(Auth.MESSAGES[code]).toEqual(expect.any(String));
      expect(Auth.messageFor(code)).toBe(Auth.MESSAGES[code]);
    }
    // And for every error code the server puts on the login page after a Google/Kakao sign-in.
    const routes = read('src/routes/customerAuth.ts');
    const fixed = [...routes.matchAll(/backToLogin\(res, '([a-z_]+)'/g)].map(match => match[1]);
    expect(fixed.length).toBeGreaterThan(3);
    for (const code of [...fixed, 'email_missing', 'email_not_verified', 'provider_error']) {
      expect(Auth.MESSAGES[code]).toEqual(expect.any(String));
    }
  });

  it('answers an unknown code, or a code that is a property of Object, with the general message', () => {
    expect(Auth.messageFor('constructor')).toBe(Auth.MESSAGES.unexpected);
    expect(Auth.messageFor('<img src=x>')).toBe(Auth.MESSAGES.unexpected);
    expect(Auth.messageFor(undefined)).toBe(Auth.MESSAGES.unexpected);
  });
});
