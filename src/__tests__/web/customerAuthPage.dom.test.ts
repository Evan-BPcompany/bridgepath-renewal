/**
 * @jest-environment jsdom
 */
import { loadPage, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const SCRIPTS = ['config.js', 'customer-auth.js', 'customer-auth-page.js'];
const API = 'http://localhost:4000/api/customers';

type Answer = { status: number; body?: unknown };
type Call = { method: string; path: string; body: any; credentials: string };

const CUSTOMER = { id: 'c1', email: 'buyer@example.com', name: 'Kim', consent_required: false };
const ok = (body: unknown = {}): Answer => ({ status: 200, body });
const refuse = (status: number, code: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { code, error: code, ...extra } });

// A fake of fetch: answers by "METHOD /path", and remembers every call.
function fakeApi(routes: Record<string, Answer | ((call: Call) => Answer)>) {
  const calls: Call[] = [];
  const impl = jest.fn(async (url: string, init: any) => {
    const path = url.replace(API, '').replace(/\?.*$/, '');
    const call: Call = { method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials };
    calls.push(call);
    const route = routes[`${call.method} ${path}`];
    const answer: Answer = typeof route === 'function' ? route(call) : route ?? refuse(404, 'unexpected');
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  });
  return { calls, impl };
}

// The fake fetch answers in microtasks only, so this also works while the timers are faked.
const flush = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

const type = (selector: string, value: string): void => {
  $(selector).value = value;
  $(selector).dispatchEvent(new g.Event('input', { bubbles: true }));
};
const click = (selector: string): void => $(selector).dispatchEvent(new g.MouseEvent('click', { bubbles: true }));
const submit = (selector: string): void => $(selector).dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));
const visibleSteps = (): string[] => $$('.auth-step').filter(el => !el.hidden).map(el => el.dataset.step);
const typeCode = (code: string): void => {
  const boxes = $$('.auth-code-box');
  code.split('').forEach((digit, i) => {
    boxes[i].value = digit;
    boxes[i].dispatchEvent(new g.Event('input', { bubbles: true }));
  });
};

describe('login.html in jsdom (fake API)', () => {
  let page: LoadedPage | undefined;
  let go: jest.Mock;

  // Opens the page at an address (with a query), with these routes. /me is "not signed in" unless given.
  async function open(routes: Record<string, Answer | ((call: Call) => Answer)> = {}, search = '') {
    g.history.replaceState({}, '', `/login.html${search}`);
    const api = fakeApi({
      'GET /me': refuse(401, 'CUSTOMER_AUTH_REQUIRED'),
      'GET /oauth/providers': ok({ providers: { google: false, kakao: false } }),
      ...routes
    });
    g.fetch = api.impl;
    page = loadPage('login.html', SCRIPTS);
    go = jest.fn();
    g.BridgePathAuthPage.go = go;
    await flush();
    return api;
  }

  afterEach(() => {
    jest.useRealTimers();
    page?.dispose();
    page = undefined;
    delete g.BridgePathAuth;
    delete g.BridgePathAuthPage;
    delete g.BridgePathConfig;
    delete g.fetch;
  });

  describe('first look', () => {
    it('shows the login step only, with no social button when no provider is on, and asks who is signed in', async () => {
      const api = await open();

      expect(visibleSteps()).toEqual(['login']);
      expect($('#socialBox').hidden).toBe(true);
      expect($('#notice').hidden).toBe(true);
      expect(api.calls.map(call => `${call.method} ${call.path}`).sort()).toEqual(['GET /me', 'GET /oauth/providers']);
      expect(api.calls.every(call => call.credentials === 'include')).toBe(true);
    });

    it('shows the Kakao and Google buttons that the server has on, with the page to come back to', async () => {
      await open({ 'GET /oauth/providers': ok({ providers: { google: true, kakao: true } }) }, '?next=/sunglasses-estimate.html');

      expect($('#socialBox').hidden).toBe(false);
      expect($('#kakaoBtn').hidden).toBe(false);
      expect($('#googleBtn').hidden).toBe(false);
      expect($('#kakaoBtn').getAttribute('href')).toBe('http://localhost:4000/api/customers/oauth/kakao/start?next=%2Fsunglasses-estimate.html');
      expect($('#googleBtn').getAttribute('href')).toBe('http://localhost:4000/api/customers/oauth/google/start?next=%2Fsunglasses-estimate.html');
    });

    it('shows only the provider that is on', async () => {
      await open({ 'GET /oauth/providers': ok({ providers: { google: false, kakao: true } }) });

      expect($('#kakaoBtn').hidden).toBe(false);
      expect($('#googleBtn').hidden).toBe(true);
    });

    it('does not follow a "next" that leaves the site', async () => {
      await open({ 'GET /oauth/providers': ok({ providers: { google: true, kakao: false } }) }, '?next=https://evil.example/');

      expect($('#googleBtn').getAttribute('href')).toBe('http://localhost:4000/api/customers/oauth/google/start?next=%2F');
    });

    it('opens on the sign-up step for ?mode=signup', async () => {
      await open({}, '?mode=signup');
      expect(visibleSteps()).toEqual(['signup']);
    });

    it('says what went wrong after a Google/Kakao sign-in, in words, from a fixed code only', async () => {
      await open({}, '?error=email_missing');
      expect($('#notice').hidden).toBe(false);
      expect($('#notice').textContent).toContain('이메일 정보를 받지 못했어요');
      page!.dispose();

      await open({}, '?error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
      expect($('#notice').textContent).toBe('문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      expect($('#notice img')).toBeNull();
    });

    it('sends someone who is already signed in on to the page they wanted', async () => {
      await open({ 'GET /me': ok({ customer: CUSTOMER }) }, '?next=/estimate.html');

      expect(go).toHaveBeenCalledWith('/estimate.html');
    });

    it('asks a signed-in Google/Kakao customer without consent for it, and sends them on after', async () => {
      const api = await open({ 'GET /me': ok({ customer: { ...CUSTOMER, consent_required: true } }) }, '?step=consent&next=/estimate.html');

      expect(go).not.toHaveBeenCalled();
      expect(visibleSteps()).toEqual(['consent']);

      submit('#consentForm');
      expect($('#consentError').hidden).toBe(false);
      expect(api.calls.some(call => call.path === '/me/consent')).toBe(false);

      api.impl.mockClear();
      g.fetch = fakeApi({ 'POST /me/consent': ok({ customer: CUSTOMER }) }).impl;
      $('#consentCheck').checked = true;
      submit('#consentForm');
      await flush();

      expect(g.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(g.fetch.mock.calls[0][1].body)).toEqual({ privacy_consent: true, privacy_consent_version: 'dev-draft' });
      expect(go).toHaveBeenCalledWith('/estimate.html');
    });
  });

  describe('login', () => {
    it('checks the e-mail and the password before asking the server', async () => {
      const api = await open();
      api.calls.length = 0;

      type('#loginEmail', 'nope');
      type('#loginPassword', 'x');
      submit('#loginForm');
      expect($('#loginError').textContent).toBe('이메일 형식을 확인해 주세요.');

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', '');
      submit('#loginForm');
      expect($('#loginError').textContent).toBe('비밀번호를 입력해 주세요.');

      await flush();
      expect(api.calls).toEqual([]);
    });

    it('logs in with the e-mail in lowercase, empties the password field and goes on to the page', async () => {
      const api = await open({ 'POST /login': ok({ customer: CUSTOMER }) }, '?next=/shoes-estimate.html');

      type('#loginEmail', ' Buyer@Example.com ');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      await flush();

      const login = api.calls.find(call => call.path === '/login')!;
      expect(login.body).toEqual({ email: 'buyer@example.com', password: 'abcdefg1' });
      expect($('#loginPassword').value).toBe('');
      expect(go).toHaveBeenCalledWith('/shoes-estimate.html');
    });

    it.each([
      [refuse(401, 'INVALID_CREDENTIALS'), '이메일 또는 비밀번호가 맞지 않아요.'],
      [refuse(429, 'ACCOUNT_LOCKED'), '로그인에 여러 번 실패해서 잠시 잠겼어요. 잠시 후 다시 시도해 주세요.'],
      [{ status: 429, body: { error: 'Too many requests' } }, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'],
      [{ status: 500, body: undefined }, '문제가 생겼어요. 잠시 후 다시 시도해 주세요.']
    ])('shows the reason for %j and stays', async (answer, text) => {
      await open({ 'POST /login': answer });

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      await flush();

      expect($('#loginError').textContent).toBe(text);
      expect($('#loginError').hidden).toBe(false);
      expect(go).not.toHaveBeenCalled();
      expect(visibleSteps()).toEqual(['login']);
    });

    it('tells the customer when the server cannot be reached', async () => {
      await open();
      g.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      await flush();

      expect($('#loginError').textContent).toContain('서버에 연결하지 못했어요');
      expect($('#loginSubmit').disabled).toBe(false);
    });

    it('goes to the code step for an e-mail that was never verified', async () => {
      await open({ 'POST /login': refuse(403, 'EMAIL_NOT_VERIFIED') });

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      await flush();

      expect(visibleSteps()).toEqual(['code']);
      expect($('#codeEmail').textContent).toBe('buyer@example.com');
      expect($('#notice').textContent).toContain('이메일 인증이 아직 끝나지 않았어요');
    });

    it('asks a Google/Kakao customer without consent for it before going on', async () => {
      await open({ 'POST /login': ok({ customer: { ...CUSTOMER, consent_required: true } }) });

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      await flush();

      expect(go).not.toHaveBeenCalled();
      expect(visibleSteps()).toEqual(['consent']);
    });

    it('sends one request at a time while the first has no answer yet', async () => {
      let release!: (answer: Answer) => void;
      const api = await open({ 'POST /login': () => refuse(500, 'x') });
      g.fetch = jest.fn(
        () => new Promise(resolve => { release = answer => resolve({ ok: false, status: answer.status, json: async () => answer.body }); })
      );

      type('#loginEmail', 'buyer@example.com');
      type('#loginPassword', 'abcdefg1');
      submit('#loginForm');
      submit('#loginForm');
      await flush(5);

      expect(g.fetch).toHaveBeenCalledTimes(1);
      expect($('#loginSubmit').disabled).toBe(true);
      release(refuse(401, 'INVALID_CREDENTIALS'));
      await flush();
      expect($('#loginSubmit').disabled).toBe(false);
      expect(api.calls.length).toBeGreaterThan(0);
    });
  });

  describe('sign-up with an e-mail code', () => {
    const fill = (over: Record<string, string> = {}): void => {
      const values = {
        '#signupEmail': 'Buyer@Example.com', '#signupPassword': 'abcdefg1', '#signupName': 'Kim', '#signupPhone': '010-1234-5678',
        '#signupCompany': 'ACME', ...over
      };
      Object.entries(values).forEach(([selector, value]) => type(selector, value));
      $('#signupConsent').checked = true;
    };

    it('switches between login and sign-up', async () => {
      await open();

      click('#toSignup');
      expect(visibleSteps()).toEqual(['signup']);
      click('#signupBack');
      expect(visibleSteps()).toEqual(['login']);
    });

    it.each([
      [{ '#signupEmail': 'nope' }, '이메일 형식을 확인해 주세요.'],
      [{ '#signupPassword': 'abc' }, '비밀번호는 8자 이상으로 입력해 주세요.'],
      [{ '#signupPassword': 'abcdefgh' }, '비밀번호에는 글자와 숫자가 모두 들어가야 해요.'],
      [{ '#signupName': '  ' }, '이름을 입력해 주세요.'],
      [{ '#signupPhone': 'call me' }, '전화번호는 숫자 7~15자리로 입력해 주세요. 숫자, 공백, +, -, ( )만 쓸 수 있어요.']
    ])('refuses %j with a message, asking nothing', async (change, message) => {
      const api = await open();
      api.calls.length = 0;
      click('#toSignup');

      fill(change);
      submit('#signupForm');
      await flush();

      expect($('#signupError').textContent).toBe(message);
      expect(api.calls).toEqual([]);
    });

    it('needs the consent', async () => {
      const api = await open();
      api.calls.length = 0;
      click('#toSignup');

      fill();
      $('#signupConsent').checked = false;
      submit('#signupForm');

      expect($('#signupError').textContent).toBe('개인정보 수집·이용에 동의해 주세요.');
      expect(api.calls).toEqual([]);
    });

    it('sends the sign-up with the consent version, empties the password and shows the code step with a countdown', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const api = await open({ 'POST /signup': { status: 201, body: { email: 'buyer@example.com', resend_after_seconds: 60 } } });

      click('#toSignup');
      fill();
      submit('#signupForm');
      await flush();

      const signup = api.calls.find(call => call.path === '/signup')!;
      expect(signup.body).toEqual({
        email: 'buyer@example.com', password: 'abcdefg1', name: 'Kim', phone: '010-1234-5678', company_name: 'ACME',
        privacy_consent: true, privacy_consent_version: 'dev-draft'
      });
      expect($('#signupPassword').value).toBe('');
      expect(visibleSteps()).toEqual(['code']);
      expect($('#codeEmail').textContent).toBe('buyer@example.com');
      expect($('#codeResend').disabled).toBe(true);
      expect($('#codeResend').textContent).toBe('인증코드 재전송 (60초)');

      jest.advanceTimersByTime(59000);
      expect($('#codeResend').textContent).toBe('인증코드 재전송 (1초)');
      jest.advanceTimersByTime(1000);
      expect($('#codeResend').disabled).toBe(false);
      expect($('#codeResend').textContent).toBe('인증코드 재전송');
    });

    it('leaves out the optional fields that are empty', async () => {
      const api = await open({ 'POST /signup': { status: 201, body: { resend_after_seconds: 60 } } });

      click('#toSignup');
      fill({ '#signupPhone': '', '#signupCompany': '' });
      submit('#signupForm');
      await flush();

      expect(Object.keys(api.calls.find(call => call.path === '/signup')!.body).sort()).toEqual([
        'email', 'name', 'password', 'privacy_consent', 'privacy_consent_version'
      ]);
    });

    it('says when the e-mail is already registered, and stays on the form', async () => {
      await open({ 'POST /signup': refuse(409, 'EMAIL_TAKEN') });

      click('#toSignup');
      fill();
      submit('#signupForm');
      await flush();

      expect($('#signupError').textContent).toBe('이미 가입된 이메일이에요. 로그인해 주세요.');
      expect(visibleSteps()).toEqual(['signup']);
    });

    it('goes to the code step when a code was sent a moment ago (the earlier code still counts)', async () => {
      await open({ 'POST /signup': refuse(429, 'CODE_TOO_SOON', { retry_after_seconds: 42 }) });

      click('#toSignup');
      fill();
      submit('#signupForm');
      await flush();

      expect(visibleSteps()).toEqual(['code']);
      expect($('#codeResend').textContent).toBe('인증코드 재전송 (42초)');
    });

    it('goes back from the code step to the form', async () => {
      await open({ 'POST /signup': { status: 201, body: {} } });
      click('#toSignup');
      fill();
      submit('#signupForm');
      await flush();

      click('#codeBack');

      expect(visibleSteps()).toEqual(['signup']);
      expect($('#signupEmail').value).toBe('Buyer@Example.com');
    });
  });

  describe('the code step', () => {
    async function atCodeStep(routes: Record<string, Answer | ((call: Call) => Answer)> = {}, search = '') {
      const api = await open({ 'POST /signup': { status: 201, body: { resend_after_seconds: 60 } }, ...routes }, search);
      click('#toSignup');
      type('#signupEmail', 'buyer@example.com');
      type('#signupPassword', 'abcdefg1');
      type('#signupName', 'Kim');
      $('#signupConsent').checked = true;
      submit('#signupForm');
      await flush();
      return api;
    }

    it('has six boxes for digits, and sends the code by itself when the sixth is filled', async () => {
      const api = await atCodeStep({ 'POST /verify-email': ok({ customer: CUSTOMER }) }, '?next=/estimate.html');
      expect($$('.auth-code-box')).toHaveLength(6);

      typeCode('12345');
      await flush();
      expect(api.calls.some(call => call.path === '/verify-email')).toBe(false);

      typeCode('123456');
      await flush();

      expect(api.calls.find(call => call.path === '/verify-email')!.body).toEqual({ email: 'buyer@example.com', code: '123456' });
      expect(go).toHaveBeenCalledWith('/estimate.html');
    });

    it('keeps only digits, one to a box', async () => {
      await atCodeStep();
      const boxes = $$('.auth-code-box');

      boxes[0].value = 'a';
      boxes[0].dispatchEvent(new g.Event('input', { bubbles: true }));
      expect(boxes[0].value).toBe('');

      boxes[0].value = '78';
      boxes[0].dispatchEvent(new g.Event('input', { bubbles: true }));
      expect(boxes[0].value).toBe('8');
      expect(g.document.activeElement).toBe(boxes[1]);
    });

    it('takes a pasted code', async () => {
      const api = await atCodeStep({ 'POST /verify-email': ok({ customer: CUSTOMER }) });
      const paste = new g.Event('paste', { bubbles: true, cancelable: true });
      paste.clipboardData = { getData: () => ' 654 321 ' };

      $$('.auth-code-box')[0].dispatchEvent(paste);
      await flush();

      expect(paste.defaultPrevented).toBe(true);
      expect($$('.auth-code-box').map(box => box.value).join('')).toBe('654321');
      expect(api.calls.find(call => call.path === '/verify-email')!.body.code).toBe('654321');
    });

    it.each([
      ['INVALID_CODE', '인증코드가 맞지 않아요. 다시 확인해 주세요.'],
      ['CODE_EXPIRED', '인증코드가 만료됐어요. 코드를 다시 받아 주세요.'],
      ['TOO_MANY_ATTEMPTS', '인증코드를 여러 번 틀렸어요. 코드를 다시 받아 주세요.']
    ])('shows %s, empties the boxes and does not sign in', async (code, text) => {
      await atCodeStep({ 'POST /verify-email': refuse(400, code) });

      typeCode('111111');
      await flush();

      expect($('#codeError').textContent).toBe(text);
      expect($$('.auth-code-box').every(box => box.value === '')).toBe(true);
      expect(go).not.toHaveBeenCalled();
    });

    it('asks for a new code and starts the countdown again', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const api = await atCodeStep({ 'POST /resend-code': ok({ resend_after_seconds: 60 }) });
      jest.advanceTimersByTime(60000);
      expect($('#codeResend').disabled).toBe(false);

      click('#codeResend');
      await flush();

      expect(api.calls.find(call => call.path === '/resend-code')!.body).toEqual({ email: 'buyer@example.com' });
      expect($('#notice').textContent).toBe('인증코드를 다시 보냈어요. 메일함을 확인해 주세요.');
      expect($('#codeResend').disabled).toBe(true);
      expect($('#codeResend').textContent).toBe('인증코드 재전송 (60초)');
    });

    it('can be asked again after a failure to send', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      await atCodeStep({ 'POST /resend-code': refuse(503, 'EMAIL_UNAVAILABLE') });
      jest.advanceTimersByTime(60000);

      click('#codeResend');
      await flush();

      expect($('#codeError').textContent).toBe('이메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
      expect($('#codeResend').disabled).toBe(false);
    });
  });

  describe('password reset', () => {
    it('asks for the code, then for the new password, and ends on the login step with the e-mail filled in', async () => {
      const api = await open({
        'POST /password-reset/request': ok({ resend_after_seconds: 60 }),
        'POST /password-reset/confirm': ok({})
      });

      type('#loginEmail', 'buyer@example.com');
      click('#toReset');
      expect(visibleSteps()).toEqual(['reset-request']);
      expect($('#resetEmail').value).toBe('buyer@example.com');

      submit('#resetRequestForm');
      await flush();
      expect(visibleSteps()).toEqual(['reset']);
      expect($('#resetEmailShown').textContent).toBe('buyer@example.com');

      type('#resetCode', '123456');
      type('#resetPassword', 'brand-new-1');
      submit('#resetForm');
      await flush();

      expect(api.calls.find(call => call.path === '/password-reset/confirm')!.body).toEqual({
        email: 'buyer@example.com', code: '123456', new_password: 'brand-new-1'
      });
      expect($('#resetPassword').value).toBe('');
      expect(visibleSteps()).toEqual(['login']);
      expect($('#loginEmail').value).toBe('buyer@example.com');
      expect($('#notice').textContent).toBe('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.');
    });

    it('checks the e-mail, then the code and the new password, before asking the server', async () => {
      const api = await open();
      api.calls.length = 0;
      click('#toReset');

      type('#resetEmail', 'nope');
      submit('#resetRequestForm');
      expect($('#resetRequestError').textContent).toBe('이메일 형식을 확인해 주세요.');

      g.fetch = fakeApi({ 'POST /password-reset/request': ok({}) }).impl;
      type('#resetEmail', 'buyer@example.com');
      submit('#resetRequestForm');
      await flush();

      g.fetch = jest.fn();
      type('#resetCode', '12');
      type('#resetPassword', 'brand-new-1');
      submit('#resetForm');
      expect($('#resetError').textContent).toBe('인증코드 6자리를 모두 입력해 주세요.');
      type('#resetCode', '123456');
      type('#resetPassword', 'short');
      submit('#resetForm');
      expect($('#resetError').textContent).toBe('비밀번호는 8자 이상으로 입력해 주세요.');
      expect(g.fetch).not.toHaveBeenCalled();
    });

    it('shows the answer of the server for a wrong code and stays', async () => {
      await open({ 'POST /password-reset/request': ok({}), 'POST /password-reset/confirm': refuse(400, 'INVALID_CODE') });
      type('#loginEmail', 'buyer@example.com');
      click('#toReset');
      submit('#resetRequestForm');
      await flush();

      type('#resetCode', '000000');
      type('#resetPassword', 'brand-new-1');
      submit('#resetForm');
      await flush();

      expect($('#resetError').textContent).toBe('인증코드가 맞지 않아요. 다시 확인해 주세요.');
      expect(visibleSteps()).toEqual(['reset']);
    });
  });
});
