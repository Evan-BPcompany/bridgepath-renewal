jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/customerAuthService', () => ({
  ...jest.requireActual('../services/customerAuthService'),
  signup: jest.fn(),
  findCustomerByEmail: jest.fn(),
  issueCode: jest.fn(),
  consumeCode: jest.fn(),
  markEmailVerified: jest.fn(),
  createSession: jest.fn(),
  findSessionCustomer: jest.fn(),
  revokeSession: jest.fn(),
  loginWithPassword: jest.fn(),
  loginWithSocial: jest.fn(),
  setPassword: jest.fn(),
  recordConsent: jest.fn(),
  setKakaoNotify: jest.fn(),
  updateProfile: jest.fn(),
  loadPublicCustomer: jest.fn()
}));
jest.mock('../services/customerMailer', () => ({
  ...jest.requireActual('../services/customerMailer'),
  sendCodeEmail: jest.fn()
}));
jest.mock('../services/oauthProviders', () => ({
  ...jest.requireActual('../services/oauthProviders'),
  fetchSocialProfile: jest.fn()
}));

import request from 'supertest';
import type { Express } from 'express';
import { config } from '../config/env';
import logger from '../utils/logger';
import { createApp } from '../app';
import * as service from '../services/customerAuthService';
import { CustomerAuthError } from '../services/customerAuthService';
import { MailUnavailableError, sendCodeEmail } from '../services/customerMailer';
import { OAuthError, fetchSocialProfile } from '../services/oauthProviders';

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

const TOKEN = 'a'.repeat(64);
const CUSTOMER = {
  id: 'c0000000-0000-0000-0000-0000000000c1',
  email: 'buyer@example.com',
  name: 'Kim',
  phone: null,
  company_name: null,
  customer_type: null,
  has_password: true,
  providers: [],
  consent_required: false,
  phone_required: false
};
const SIGNUP = {
  email: 'Buyer@Example.com',
  password: 'abcdefg1',
  name: 'Kim',
  phone: '010-1234-5678',
  privacy_consent: true,
  privacy_consent_version: 'dev-draft'
};
const FRONT = config.frontendBaseUrl;

function cookieOf(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find(line => line.startsWith(`${name}=`));
}

describe('customer accounts API (mocked services)', () => {
  let app: Express;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const big = { windowMs: 60_000, max: 100000 };
    app = createApp({ rateLimits: { customerLogin: big, customerSignup: big, customerCode: big } });
    mocked(service.signup).mockResolvedValue({ customerId: CUSTOMER.id });
    mocked(service.issueCode).mockResolvedValue('123456');
    mocked(service.createSession).mockResolvedValue(TOKEN);
    mocked(service.loadPublicCustomer).mockResolvedValue(CUSTOMER);
    mocked(service.findCustomerByEmail).mockResolvedValue({ id: CUSTOMER.id, verified: false, active: true });
    mocked(service.findSessionCustomer).mockResolvedValue({ customer: CUSTOMER, sessionId: 's1' });
    mocked(sendCodeEmail).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    config.oauth.google = undefined;
    config.oauth.kakao = undefined;
  });

  describe('POST /api/customers/signup', () => {
    it('makes the account, mails a 6-digit code and says when to ask again', async () => {
      const res = await request(app).post('/api/customers/signup').send(SIGNUP);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'buyer@example.com', resend_after_seconds: 60 });
      expect(JSON.stringify(res.body)).not.toContain('123456');
      expect(service.signup).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'buyer@example.com',
          consentVersion: 'dev-draft',
          profile: expect.objectContaining({ name: 'Kim', phone: '010-1234-5678' })
        })
      );
      expect(sendCodeEmail).toHaveBeenCalledWith('buyer@example.com', 'signup', '123456');
      expect(cookieOf(res, 'bp_session')).toBeUndefined();
    });

    it('records the KakaoTalk consent only for an explicit true, never by default', async () => {
      await request(app).post('/api/customers/signup').send(SIGNUP);
      await request(app).post('/api/customers/signup').send({ ...SIGNUP, kakao_notify: 'true' });
      await request(app).post('/api/customers/signup').send({ ...SIGNUP, kakao_notify: true });

      const given = mocked(service.signup).mock.calls.map(call => call[0].kakaoNotify);
      expect(given).toEqual([false, false, true]);
    });

    it.each([
      ['a bad e-mail', { email: 'nope' }, 'email'],
      ['a weak password', { password: 'abcdefgh' }, 'password'],
      ['no name', { name: '' }, 'name'],
      ['a bad phone', { phone: 'x' }, 'phone'],
      ['no phone', { phone: undefined }, 'phone'],
      ['an empty phone', { phone: '  ' }, 'phone']
    ])('refuses %s and stores nothing', async (_label, change, field) => {
      const res = await request(app).post('/api/customers/signup').send({ ...SIGNUP, ...change });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
      expect(service.signup).not.toHaveBeenCalled();
      expect(sendCodeEmail).not.toHaveBeenCalled();
    });

    it('needs the privacy consent, with a version the server knows', async () => {
      for (const change of [{ privacy_consent: false }, { privacy_consent: 'true' }, { privacy_consent_version: 'made-up' }, { privacy_consent_version: undefined }]) {
        const res = await request(app).post('/api/customers/signup').send({ ...SIGNUP, ...change });
        expect(res.status).toBe(400);
        expect(res.body.details[0].field).toBe('privacy_consent');
      }
      expect(service.signup).not.toHaveBeenCalled();
    });

    it('answers 409 for an e-mail that is already registered', async () => {
      mocked(service.signup).mockRejectedValue(new CustomerAuthError('EMAIL_TAKEN'));

      const res = await request(app).post('/api/customers/signup').send(SIGNUP);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
      expect(sendCodeEmail).not.toHaveBeenCalled();
    });

    it('answers 503 when the mail cannot be sent, and 429 when a code was just sent', async () => {
      mocked(sendCodeEmail).mockRejectedValueOnce(new MailUnavailableError());
      const unavailable = await request(app).post('/api/customers/signup').send(SIGNUP);
      expect(unavailable.status).toBe(503);
      expect(unavailable.body.code).toBe('EMAIL_UNAVAILABLE');

      mocked(service.issueCode).mockRejectedValueOnce(new CustomerAuthError('CODE_TOO_SOON', 42));
      const soon = await request(app).post('/api/customers/signup').send(SIGNUP);
      expect(soon.status).toBe(429);
      expect(soon.body).toMatchObject({ code: 'CODE_TOO_SOON', retry_after_seconds: 42 });
    });

    it('does not take a body that is not an object', async () => {
      const res = await request(app).post('/api/customers/signup').send([1, 2]);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/customers/verify-email', () => {
    it('signs the customer in with a session cookie that scripts cannot read', async () => {
      const res = await request(app).post('/api/customers/verify-email').send({ email: 'Buyer@Example.com', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.customer).toEqual(CUSTOMER);
      expect(service.consumeCode).toHaveBeenCalledWith(CUSTOMER.id, 'signup', '123456');
      expect(service.markEmailVerified).toHaveBeenCalledWith(CUSTOMER.id);
      const cookie = cookieOf(res, 'bp_session')!;
      expect(cookie).toContain(`bp_session=${TOKEN}`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api(;|$)/);
    });

    it('does not tell an unknown e-mail from a wrong code', async () => {
      mocked(service.findCustomerByEmail).mockResolvedValue(undefined);
      const unknown = await request(app).post('/api/customers/verify-email').send({ email: 'x@example.com', code: '123456' });
      const badFormat = await request(app).post('/api/customers/verify-email').send({ email: 'x@example.com', code: '12' });

      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe('INVALID_CODE');
      expect(badFormat.status).toBe(400);
      expect(badFormat.body.code).toBe('INVALID_CODE');
      expect(service.consumeCode).not.toHaveBeenCalled();
    });

    it.each(['INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'] as const)('answers 400 %s without a session', async code => {
      mocked(service.consumeCode).mockRejectedValue(new CustomerAuthError(code));

      const res = await request(app).post('/api/customers/verify-email').send({ email: 'buyer@example.com', code: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(cookieOf(res, 'bp_session')).toBeUndefined();
      expect(service.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/customers/resend-code', () => {
    it('sends a new code to an unverified account', async () => {
      const res = await request(app).post('/api/customers/resend-code').send({ email: 'buyer@example.com' });

      expect(res.status).toBe(200);
      expect(sendCodeEmail).toHaveBeenCalledWith('buyer@example.com', 'signup', '123456');
    });

    it('answers the same for a verified account, an unknown one and a too-early request, and sends nothing', async () => {
      mocked(service.findCustomerByEmail).mockResolvedValueOnce({ id: 'x', verified: true, active: true });
      const verified = await request(app).post('/api/customers/resend-code').send({ email: 'a@example.com' });
      mocked(service.findCustomerByEmail).mockResolvedValueOnce(undefined);
      const unknown = await request(app).post('/api/customers/resend-code').send({ email: 'b@example.com' });
      mocked(service.issueCode).mockRejectedValueOnce(new CustomerAuthError('CODE_TOO_SOON', 30));
      const early = await request(app).post('/api/customers/resend-code').send({ email: 'c@example.com' });

      for (const res of [verified, unknown, early]) {
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('If a code is due it was sent');
      }
      expect(sendCodeEmail).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/customers/login', () => {
    it('starts a session for the right password', async () => {
      mocked(service.loginWithPassword).mockResolvedValue({ customerId: CUSTOMER.id });

      const res = await request(app).post('/api/customers/login').send({ email: 'Buyer@Example.com', password: 'abcdefg1' });

      expect(res.status).toBe(200);
      expect(res.body.customer).toEqual(CUSTOMER);
      expect(service.loginWithPassword).toHaveBeenCalledWith('buyer@example.com', 'abcdefg1');
      expect(cookieOf(res, 'bp_session')).toContain(`bp_session=${TOKEN}`);
    });

    it('needs an e-mail and a password', async () => {
      for (const body of [{}, { email: 'buyer@example.com' }, { password: 'x' }, { email: 'nope', password: 'x' }]) {
        expect((await request(app).post('/api/customers/login').send(body)).status).toBe(400);
      }
      expect(service.loginWithPassword).not.toHaveBeenCalled();
    });

    it('answers 401 for wrong credentials and 429 for a locked account, with no cookie', async () => {
      mocked(service.loginWithPassword).mockRejectedValueOnce(new CustomerAuthError('INVALID_CREDENTIALS'));
      const wrong = await request(app).post('/api/customers/login').send({ email: 'buyer@example.com', password: 'x' });
      mocked(service.loginWithPassword).mockRejectedValueOnce(new CustomerAuthError('ACCOUNT_LOCKED'));
      const locked = await request(app).post('/api/customers/login').send({ email: 'buyer@example.com', password: 'x' });

      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      expect(cookieOf(wrong, 'bp_session')).toBeUndefined();
      expect(cookieOf(locked, 'bp_session')).toBeUndefined();
    });

    it('answers 403 for an unverified e-mail and sends a fresh code', async () => {
      mocked(service.loginWithPassword).mockRejectedValue(new CustomerAuthError('EMAIL_NOT_VERIFIED'));

      const res = await request(app).post('/api/customers/login').send({ email: 'buyer@example.com', password: 'abcdefg1' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(sendCodeEmail).toHaveBeenCalledWith('buyer@example.com', 'signup', '123456');
      expect(cookieOf(res, 'bp_session')).toBeUndefined();
    });
  });

  describe('session, profile and logout', () => {
    it('GET /me is 401 without a cookie, and with one that is not a token', async () => {
      expect((await request(app).get('/api/customers/me')).status).toBe(401);
      expect((await request(app).get('/api/customers/me').set('Cookie', 'bp_session=short')).status).toBe(401);
      expect(service.findSessionCustomer).not.toHaveBeenCalled();
    });

    it('GET /me gives the customer, never the hash of the password', async () => {
      const res = await request(app).get('/api/customers/me').set('Cookie', `bp_session=${TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.customer).toEqual(CUSTOMER);
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash|token_hash/);
    });

    it('GET /me is 401 when the session is unknown, revoked or expired', async () => {
      mocked(service.findSessionCustomer).mockResolvedValue(undefined);
      expect((await request(app).get('/api/customers/me').set('Cookie', `bp_session=${TOKEN}`)).status).toBe(401);
    });

    it('PATCH /me needs a session and checks the profile', async () => {
      expect((await request(app).patch('/api/customers/me').send({ name: 'Lee' })).status).toBe(401);

      const bad = await request(app).patch('/api/customers/me').set('Cookie', `bp_session=${TOKEN}`).send({ phone: 'x' });
      expect(bad.status).toBe(400);

      mocked(service.updateProfile).mockResolvedValue({ ...CUSTOMER, name: 'Lee' });
      const ok = await request(app).patch('/api/customers/me').set('Cookie', `bp_session=${TOKEN}`).send({ name: 'Lee' });
      expect(ok.status).toBe(200);
      expect(service.updateProfile).toHaveBeenCalledWith(CUSTOMER.id, expect.objectContaining({ name: 'Lee' }));
    });

    describe('POST /me/kakao-notify (agreeing to the KakaoTalk notices, and taking it back)', () => {
      const send = (body: unknown) => request(app).post('/api/customers/me/kakao-notify').set('Cookie', `bp_session=${TOKEN}`).send(body as object);

      it('needs a session', async () => {
        expect((await request(app).post('/api/customers/me/kakao-notify').send({ enabled: true })).status).toBe(401);
      });

      it.each([true, false])('sets the consent to %s and answers with the customer', async enabled => {
        const res = await send({ enabled });

        expect(res.status).toBe(200);
        expect(service.setKakaoNotify).toHaveBeenCalledWith(CUSTOMER.id, enabled);
        expect(res.body.customer.id).toBe(CUSTOMER.id);
      });

      it.each([{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }])('refuses %j: only true or false', async body => {
        const res = await send(body);

        expect(res.status).toBe(400);
        expect(service.setKakaoNotify).not.toHaveBeenCalled();
      });
    });

    describe('POST /me/complete (the consent and the mobile phone of an account made with Google/Kakao)', () => {
      const complete = (body: Record<string, unknown>) =>
        request(app).post('/api/customers/me/complete').set('Cookie', `bp_session=${TOKEN}`).send(body);
      const missing = (over: Record<string, unknown>) =>
        mocked(service.findSessionCustomer).mockResolvedValue({ customer: { ...CUSTOMER, ...over }, sessionId: 's1' });
      const GOOD = { privacy_consent: true, privacy_consent_version: 'dev-draft', phone: '010-1234-5678' };

      it('needs a session', async () => {
        expect((await request(app).post('/api/customers/me/complete').send(GOOD)).status).toBe(401);
      });

      it('records the consent and the phone when both are missing', async () => {
        missing({ consent_required: true, phone_required: true, phone: null });

        const res = await complete(GOOD);

        expect(res.status).toBe(200);
        expect(service.recordConsent).toHaveBeenCalledWith(CUSTOMER.id, 'dev-draft');
        expect(service.updateProfile).toHaveBeenCalledWith(CUSTOMER.id, { phone: '010-1234-5678' });
      });

      it('asks only for what is missing: the phone alone, the consent alone', async () => {
        missing({ consent_required: false, phone_required: true, phone: null });
        expect((await complete({ phone: '010-1234-5678' })).status).toBe(200);
        expect(service.recordConsent).not.toHaveBeenCalled();

        mocked(service.updateProfile).mockClear();
        missing({ consent_required: true, phone_required: false });
        expect((await complete({ privacy_consent: true, privacy_consent_version: 'dev-draft' })).status).toBe(200);
        expect(service.recordConsent).toHaveBeenCalledTimes(1);
        expect(service.updateProfile).not.toHaveBeenCalled();
      });

      it('refuses a missing or wrong phone, or a missing consent, and writes nothing', async () => {
        missing({ consent_required: true, phone_required: true, phone: null });

        const noPhone = await complete({ privacy_consent: true, privacy_consent_version: 'dev-draft' });
        const badPhone = await complete({ ...GOOD, phone: 'call me' });
        const noConsent = await complete({ phone: '010-1234-5678' });
        const badVersion = await complete({ ...GOOD, privacy_consent_version: 'x' });

        expect(noPhone.status).toBe(400);
        expect(noPhone.body.details[0].field).toBe('phone');
        expect(badPhone.status).toBe(400);
        expect(noConsent.status).toBe(400);
        expect(noConsent.body.details[0].field).toBe('privacy_consent');
        expect(badVersion.status).toBe(400);
        expect(service.recordConsent).not.toHaveBeenCalled();
        expect(service.updateProfile).not.toHaveBeenCalled();
      });

      it('writes nothing of the consent when the phone is wrong', async () => {
        missing({ consent_required: true, phone_required: true, phone: null });

        await complete({ ...GOOD, phone: '12' });

        expect(service.recordConsent).not.toHaveBeenCalled();
      });
    });

    it('logout ends the session and clears the cookie, even without one', async () => {
      const res = await request(app).post('/api/customers/logout').set('Cookie', `bp_session=${TOKEN}`);

      expect(res.status).toBe(200);
      expect(service.revokeSession).toHaveBeenCalledWith(TOKEN);
      expect(cookieOf(res, 'bp_session')).toMatch(/Expires=Thu, 01 Jan 1970/);

      mocked(service.revokeSession).mockClear();
      expect((await request(app).post('/api/customers/logout')).status).toBe(200);
      expect(service.revokeSession).not.toHaveBeenCalled();
    });
  });

  describe('password reset', () => {
    it('answers the same whether or not the account exists', async () => {
      mocked(service.findCustomerByEmail).mockResolvedValueOnce({ id: CUSTOMER.id, verified: true, active: true });
      const known = await request(app).post('/api/customers/password-reset/request').send({ email: 'buyer@example.com' });
      mocked(service.findCustomerByEmail).mockResolvedValueOnce(undefined);
      const unknown = await request(app).post('/api/customers/password-reset/request').send({ email: 'nobody@example.com' });

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body.message).toBe(unknown.body.message);
      expect(sendCodeEmail).toHaveBeenCalledTimes(1);
      expect(sendCodeEmail).toHaveBeenCalledWith('buyer@example.com', 'password_reset', '123456');
    });

    it('sets the new password after the right code, checking the password first', async () => {
      mocked(service.findCustomerByEmail).mockResolvedValue({ id: CUSTOMER.id, verified: true, active: true });
      const weak = await request(app)
        .post('/api/customers/password-reset/confirm')
        .send({ email: 'buyer@example.com', code: '123456', new_password: 'short' });
      expect(weak.status).toBe(400);
      expect(weak.body.details[0].field).toBe('new_password');
      expect(service.consumeCode).not.toHaveBeenCalled();

      const ok = await request(app)
        .post('/api/customers/password-reset/confirm')
        .send({ email: 'buyer@example.com', code: '123456', new_password: 'brand-new-1' });
      expect(ok.status).toBe(200);
      expect(service.consumeCode).toHaveBeenCalledWith(CUSTOMER.id, 'password_reset', '123456');
      expect(service.setPassword).toHaveBeenCalledWith(CUSTOMER.id, 'brand-new-1');
      expect(cookieOf(ok, 'bp_session')).toBeUndefined();
    });

    it('does not change the password after a wrong code', async () => {
      mocked(service.findCustomerByEmail).mockResolvedValue({ id: CUSTOMER.id, verified: true, active: true });
      mocked(service.consumeCode).mockRejectedValue(new CustomerAuthError('INVALID_CODE'));

      const res = await request(app)
        .post('/api/customers/password-reset/confirm')
        .send({ email: 'buyer@example.com', code: '000000', new_password: 'brand-new-1' });

      expect(res.status).toBe(400);
      expect(service.setPassword).not.toHaveBeenCalled();
    });
  });

  describe('Google and Kakao', () => {
    const enable = (): void => {
      config.oauth.google = { clientId: 'google-id', clientSecret: 'google-secret' };
      config.oauth.kakao = { clientId: 'kakao-id' };
    };

    it('lists which providers are on', async () => {
      expect((await request(app).get('/api/customers/oauth/providers')).body.providers).toEqual({ google: false, kakao: false });
      config.oauth.kakao = { clientId: 'kakao-id' };
      expect((await request(app).get('/api/customers/oauth/providers')).body.providers).toEqual({ google: false, kakao: true });
    });

    it('sends the customer back to the login page when a provider is off or unknown', async () => {
      for (const provider of ['google', 'naver']) {
        const res = await request(app).get(`/api/customers/oauth/${provider}/start`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(`${FRONT}/login.html?error=provider_unavailable`);
      }
    });

    it('starts: a redirect to Google with a state that the cookie remembers', async () => {
      enable();

      const res = await request(app).get('/api/customers/oauth/google/start?next=/sunglasses-estimate.html');

      expect(res.status).toBe(302);
      const url = new URL(res.headers.location);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const cookie = cookieOf(res, 'bp_oauth')!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/customers\/oauth/);
      expect(cookie).not.toContain(url.searchParams.get('state')!.slice(0, 8) + 'plain');
    });

    // Starts a login and returns the cookie and the state, as a browser would carry them back.
    const startLogin = async (provider: string, next = '/sunglasses-estimate.html') => {
      const res = await request(app).get(`/api/customers/oauth/${provider}/start`).query({ next });
      const state = new URL(res.headers.location).searchParams.get('state')!;
      const cookie = cookieOf(res, 'bp_oauth')!.split(';')[0];
      return { state, cookie };
    };

    it('finishes: the profile becomes a session and the browser goes on to the page it came from', async () => {
      enable();
      mocked(fetchSocialProfile).mockResolvedValue({ provider: 'google', providerUserId: 'g-1', email: 'buyer@example.com', name: 'Kim' });
      mocked(service.loginWithSocial).mockResolvedValue({ customerId: CUSTOMER.id, created: false });
      const { state, cookie } = await startLogin('google');

      const res = await request(app).get('/api/customers/oauth/google/callback').query({ code: 'abc', state }).set('Cookie', cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${FRONT}/sunglasses-estimate.html`);
      expect(cookieOf(res, 'bp_session')).toContain(`bp_session=${TOKEN}`);
      expect(fetchSocialProfile).toHaveBeenCalledWith('google', 'abc', expect.any(String));
      expect(cookieOf(res, 'bp_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it.each([
      [{ consent_required: true }],
      [{ phone_required: true }],
      [{ consent_required: true, phone_required: true }]
    ])('asks a new Google or Kakao customer for what is missing first (%j)', async missingParts => {
      enable();
      mocked(fetchSocialProfile).mockResolvedValue({ provider: 'kakao', providerUserId: '9', email: 'buyer@example.com' });
      mocked(service.loginWithSocial).mockResolvedValue({ customerId: CUSTOMER.id, created: true });
      mocked(service.loadPublicCustomer).mockResolvedValue({ ...CUSTOMER, ...missingParts });
      const { state, cookie } = await startLogin('kakao');

      const res = await request(app).get('/api/customers/oauth/kakao/callback').query({ code: 'abc', state }).set('Cookie', cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${FRONT}/login.html?step=complete&next=%2Fsunglasses-estimate.html`);
    });

    it('refuses a callback whose state is not the one the cookie holds, or that has no cookie', async () => {
      enable();
      const { cookie } = await startLogin('google');

      const wrongState = await request(app).get('/api/customers/oauth/google/callback').query({ code: 'abc', state: 'x'.repeat(32) }).set('Cookie', cookie);
      const noCookie = await request(app).get('/api/customers/oauth/google/callback').query({ code: 'abc', state: 'x' });
      const otherProvider = await request(app).get('/api/customers/oauth/kakao/callback').query({ code: 'abc', state: 'x' }).set('Cookie', cookie);

      for (const res of [wrongState, noCookie, otherProvider]) {
        expect(res.status).toBe(302);
        expect(res.headers.location).toMatch(/\/login\.html\?error=state_invalid/);
        expect(cookieOf(res, 'bp_session')).toBeUndefined();
      }
      expect(fetchSocialProfile).not.toHaveBeenCalled();
    });

    it('goes back to the login page when the customer says no on the provider page', async () => {
      enable();
      const { state, cookie } = await startLogin('google');

      const res = await request(app).get('/api/customers/oauth/google/callback').query({ error: 'access_denied', state }).set('Cookie', cookie);

      expect(res.headers.location).toMatch(/error=cancelled/);
      expect(fetchSocialProfile).not.toHaveBeenCalled();
    });

    it('gives a fixed code, never the text of an error, when the provider fails', async () => {
      enable();
      for (const [error, expected] of [
        [new OAuthError('EMAIL_MISSING'), 'email_missing'],
        [new OAuthError('EMAIL_NOT_VERIFIED'), 'email_not_verified'],
        [new OAuthError('PROVIDER_ERROR'), 'provider_error'],
        [new CustomerAuthError('INVALID_CREDENTIALS'), 'account_blocked'],
        [new Error('secret detail <script>'), 'provider_error']
      ] as const) {
        mocked(fetchSocialProfile).mockRejectedValueOnce(error);
        const { state, cookie } = await startLogin('google');

        const res = await request(app).get('/api/customers/oauth/google/callback').query({ code: 'abc', state }).set('Cookie', cookie);

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain(`error=${expected}`);
        expect(res.headers.location).not.toContain('secret');
        expect(cookieOf(res, 'bp_session')).toBeUndefined();
      }
    });

    it('never sends the browser to another site, whatever "next" says', async () => {
      enable();
      mocked(fetchSocialProfile).mockResolvedValue({ provider: 'google', providerUserId: 'g-1', email: 'buyer@example.com' });
      mocked(service.loginWithSocial).mockResolvedValue({ customerId: CUSTOMER.id, created: false });

      for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
        const { state, cookie } = await startLogin('google', next);
        const res = await request(app).get('/api/customers/oauth/google/callback').query({ code: 'abc', state }).set('Cookie', cookie);

        expect(res.status).toBe(302);
        expect(new URL(res.headers.location).origin).toBe(FRONT);
        expect(res.headers.location).toBe(`${FRONT}/`);
      }
    });
  });
});
