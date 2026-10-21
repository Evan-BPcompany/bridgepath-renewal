jest.mock('../config/database', () => ({ getPool: jest.fn() }));
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
import logger from '../utils/logger';
import { config } from '../config/env';
import { sendCodeEmail } from '../services/customerMailer';
import { fetchSocialProfile } from '../services/oauthProviders';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { cookieValueOf, createTestApp, resetData } from './helpers/fixtures';

const PASSWORD = 'abcdefg1';
const NEW_PASSWORD = 'brand-new-2';
const SIGNUP = {
  email: 'Buyer@Example.com',
  password: PASSWORD,
  name: 'Kim',
  phone: '010-1234-5678',
  company_name: 'ACME',
  customer_type: 'business_brand',
  privacy_consent: true,
  privacy_consent_version: 'dev-draft'
};

// Customer accounts against the real tables: sign-up with an e-mail code, password login and lockout,
// sessions, password reset, and Google/Kakao sign-in. The mail and the providers are replaced; the
// code that "was mailed" is read from the replaced mailer.
describeIntegration('customer accounts on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  let app: Express;

  const mailed = sendCodeEmail as unknown as jest.Mock;
  const lastCode = (email: string, purpose = 'signup'): string => {
    const calls = mailed.mock.calls.filter(call => call[0] === email && call[1] === purpose);
    return calls[calls.length - 1][2];
  };
  const customers = () => suite().db('customers').orderBy('created_at');
  const customerByEmail = (email: string) => suite().db('customers').where({ email }).first();
  // Makes the last code "old enough" to ask for a new one.
  const ageCode = (minutes: number) =>
    suite().db.raw(`UPDATE customer_email_codes SET created_at = created_at - (? * interval '1 minute')`, [minutes]);

  const signup = (body: Record<string, unknown> = {}) => request(app).post('/api/customers/signup').send({ ...SIGNUP, ...body });
  const verify = (email: string, code: string) => request(app).post('/api/customers/verify-email').send({ email, code });
  const login = (email: string, password: string) => request(app).post('/api/customers/login').send({ email, password });
  const me = (cookie: string) => request(app).get('/api/customers/me').set('Cookie', cookie);
  const sessionCookie = (res: request.Response): string => `bp_session=${cookieValueOf(res, 'bp_session')}`;

  // A customer who has signed up and verified, with the cookie of that first session.
  const registered = async (body: Record<string, unknown> = {}) => {
    const email = String(body.email ?? 'buyer@example.com').toLowerCase();
    await signup(body);
    const res = await verify(email, lastCode(email));
    return { email, cookie: sessionCookie(res), res };
  };

  beforeEach(async () => {
    await resetData(suite().db);
    app = createTestApp();
    mailed.mockReset().mockResolvedValue(undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    config.oauth.google = undefined;
    config.oauth.kakao = undefined;
  });

  describe('sign-up and the e-mail code', () => {
    it('stores an unverified account with a hashed password and a hashed code, and mails the code', async () => {
      const res = await signup();

      expect(res.status).toBe(201);
      const row = await customerByEmail('buyer@example.com');
      expect(row).toMatchObject({
        name: 'Kim', phone: '010-1234-5678', company_name: 'ACME', customer_type: 'business_brand',
        email_verified_at: null, is_active: true, privacy_consent_version: 'dev-draft'
      });
      expect(row.privacy_consent_at).toBeInstanceOf(Date);
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
      expect(row.password_hash).not.toContain(PASSWORD);

      const code = lastCode('buyer@example.com');
      expect(code).toMatch(/^[0-9]{6}$/);
      const stored = await suite().db('customer_email_codes').where({ customer_id: row.id }).first();
      expect(stored.purpose).toBe('signup');
      expect(stored.code_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stored.code_hash).not.toContain(code);
      expect(stored.attempts).toBe(0);
      expect(stored.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('cannot log in before the code is entered, and the answer is the same wrong-password shape for a stranger', async () => {
      await signup();

      const unverified = await login('buyer@example.com', PASSWORD);
      expect(unverified.status).toBe(403);
      expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');

      const stranger = await login('nobody@example.com', PASSWORD);
      const wrong = await login('buyer@example.com', 'wrong-pass-1');
      expect(stranger.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(stranger.body.code).toBe(wrong.body.code);
    });

    it('verifies with the right code: the account is verified, the code is used up, a session starts', async () => {
      await signup();

      const res = await verify('buyer@example.com', lastCode('buyer@example.com'));

      expect(res.status).toBe(200);
      expect(res.body.customer).toMatchObject({ email: 'buyer@example.com', name: 'Kim', has_password: true, consent_required: false });
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash/);
      expect((await customerByEmail('buyer@example.com')).email_verified_at).toBeInstanceOf(Date);
      expect(await suite().db('customer_email_codes').count({ n: '*' }).first()).toMatchObject({ n: '0' });

      // Only the hash of the cookie token is in the database.
      const token = cookieValueOf(res, 'bp_session')!;
      const sessions = await suite().db('customer_sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(sessions[0].token_hash).not.toBe(token);

      // The same code cannot be used twice.
      expect((await verify('buyer@example.com', lastCode('buyer@example.com'))).status).toBe(400);
    });

    it('counts wrong codes and throws the code away after five', async () => {
      await signup();
      const right = lastCode('buyer@example.com');
      const wrong = right === '000000' ? '111111' : '000000';

      for (let i = 1; i <= 4; i += 1) {
        const res = await verify('buyer@example.com', wrong);
        expect(res.body.code).toBe('INVALID_CODE');
        expect((await suite().db('customer_email_codes').first()).attempts).toBe(i);
      }
      const fifth = await verify('buyer@example.com', wrong);
      expect(fifth.body.code).toBe('TOO_MANY_ATTEMPTS');
      expect(await suite().db('customer_email_codes').count({ n: '*' }).first()).toMatchObject({ n: '0' });

      // Even the right code is useless now: a new one has to be asked for.
      expect((await verify('buyer@example.com', right)).status).toBe(400);
      expect((await customerByEmail('buyer@example.com')).email_verified_at).toBeNull();
    });

    it('refuses a code after ten minutes', async () => {
      await signup();
      await suite().db('customer_email_codes').update({ expires_at: new Date(Date.now() - 1000) });

      const res = await verify('buyer@example.com', lastCode('buyer@example.com'));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CODE_EXPIRED');
      expect((await customerByEmail('buyer@example.com')).email_verified_at).toBeNull();
    });

    it('sends a new code only once a minute, and the new code replaces the old one', async () => {
      await signup();
      const first = lastCode('buyer@example.com');
      mailed.mockClear();

      const early = await request(app).post('/api/customers/resend-code').send({ email: 'buyer@example.com' });
      expect(early.status).toBe(200);
      expect(mailed).not.toHaveBeenCalled();

      await ageCode(2);
      await request(app).post('/api/customers/resend-code').send({ email: 'buyer@example.com' });
      expect(mailed).toHaveBeenCalledTimes(1);
      const second = lastCode('buyer@example.com');
      expect(await suite().db('customer_email_codes').count({ n: '*' }).first()).toMatchObject({ n: '1' });

      if (second !== first) {
        expect((await verify('buyer@example.com', first)).status).toBe(400);
      }
      expect((await verify('buyer@example.com', second)).status).toBe(200);
    });

    it('does not mail a second code for two sign-ups in the same minute', async () => {
      await signup();
      const again = await signup({ password: 'second-pass-1' });

      expect(again.status).toBe(429);
      expect(again.body.code).toBe('CODE_TOO_SOON');
      expect(again.body.retry_after_seconds).toBeGreaterThan(0);
    });

    it('treats upper and lower case of the e-mail as one account', async () => {
      await signup();
      await verify('buyer@example.com', lastCode('buyer@example.com'));

      const again = await signup({ email: 'BUYER@example.COM' });

      expect(again.status).toBe(409);
      expect(await customers()).toHaveLength(1);
      expect((await login('BUYER@EXAMPLE.COM', PASSWORD)).status).toBe(200);
    });

    it('lets a new sign-up take over an e-mail nobody has verified, and never touches a verified one', async () => {
      await signup({ name: 'Squatter', password: 'squatter-pass-1' });
      await ageCode(2);

      const takeover = await signup({ name: 'Real Owner', password: 'owner-pass-1' });
      expect(takeover.status).toBe(201);
      expect(await customers()).toHaveLength(1);
      expect((await customerByEmail('buyer@example.com')).name).toBe('Real Owner');

      await verify('buyer@example.com', lastCode('buyer@example.com'));
      expect((await login('buyer@example.com', 'squatter-pass-1')).status).toBe(401);
      expect((await login('buyer@example.com', 'owner-pass-1')).status).toBe(200);

      const tooLate = await signup({ name: 'Later', password: 'later-pass-1' });
      expect(tooLate.status).toBe(409);
      expect((await customerByEmail('buyer@example.com')).name).toBe('Real Owner');
    });

    it('stores nothing for a sign-up that is refused', async () => {
      expect((await signup({ password: 'short' })).status).toBe(400);
      expect((await signup({ privacy_consent: false })).status).toBe(400);
      expect((await signup({ email: 'bad' })).status).toBe(400);
      expect(await customers()).toHaveLength(0);
    });

    it('keeps the account for a later try when the mail could not be sent', async () => {
      mailed.mockRejectedValueOnce(new Error('SendGrid is down'));

      const res = await signup();

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('EMAIL_UNAVAILABLE');
      expect(await customers()).toHaveLength(1);
      expect((await customerByEmail('buyer@example.com')).email_verified_at).toBeNull();
    });
  });

  describe('password login, sessions and logout', () => {
    it('logs in with any case of the e-mail and starts a session of its own', async () => {
      await registered();

      const res = await login('Buyer@Example.com', PASSWORD);

      expect(res.status).toBe(200);
      expect(await suite().db('customer_sessions').count({ n: '*' }).first()).toMatchObject({ n: '2' });
      expect((await me(sessionCookie(res))).body.customer.email).toBe('buyer@example.com');
    });

    it('locks the account after five wrong passwords, even for the right one, and a right login resets the count', async () => {
      await registered();

      for (let i = 0; i < 4; i += 1) {
        expect((await login('buyer@example.com', 'wrong-pass-1')).status).toBe(401);
      }
      expect((await customerByEmail('buyer@example.com')).failed_login_attempts).toBe(4);
      expect((await login('buyer@example.com', PASSWORD)).status).toBe(200);
      expect((await customerByEmail('buyer@example.com')).failed_login_attempts).toBe(0);

      for (let i = 0; i < 5; i += 1) {
        await login('buyer@example.com', 'wrong-pass-1');
      }
      const locked = await login('buyer@example.com', PASSWORD);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
      expect(cookieValueOf(locked, 'bp_session')).toBeUndefined();

      await suite().db('customers').update({ locked_until: new Date(Date.now() - 1000) });
      expect((await login('buyer@example.com', PASSWORD)).status).toBe(200);
    });

    it('ends a session on logout, and the cookie is useless afterwards', async () => {
      const { cookie } = await registered();
      expect((await me(cookie)).status).toBe(200);

      const out = await request(app).post('/api/customers/logout').set('Cookie', cookie);

      expect(out.status).toBe(200);
      expect((await me(cookie)).status).toBe(401);
      expect((await suite().db('customer_sessions').first()).revoked_at).toBeInstanceOf(Date);
    });

    it('refuses an expired session, an inactive account and a token nobody issued', async () => {
      const { cookie, email } = await registered();

      await suite().db('customer_sessions').update({ expires_at: new Date(Date.now() - 1000) });
      expect((await me(cookie)).status).toBe(401);

      await suite().db('customer_sessions').update({ expires_at: new Date(Date.now() + 60000) });
      expect((await me(cookie)).status).toBe(200);
      await suite().db('customers').where({ email }).update({ is_active: false });
      expect((await me(cookie)).status).toBe(401);
      expect((await login(email, PASSWORD)).status).toBe(401);

      expect((await me(`bp_session=${'f'.repeat(64)}`)).status).toBe(401);
    });

    it('does not let an admin session act as a customer session, or the other way round', async () => {
      const { cookie } = await registered();

      expect((await request(app).get('/admin/estimates').set('Cookie', cookie)).status).toBe(401);
      expect((await request(app).get('/api/customers/me').set('Cookie', 'access_token=whatever')).status).toBe(401);
    });

    it('updates the profile and records the consent of an account that has none', async () => {
      const { cookie, email } = await registered();

      const patched = await request(app).patch('/api/customers/me').set('Cookie', cookie).send({ name: 'Lee', phone: '02-123-4567' });
      expect(patched.body.customer).toMatchObject({ name: 'Lee', phone: '02-123-4567', company_name: 'ACME' });

      await suite().db('customers').where({ email }).update({ privacy_consent_at: null, privacy_consent_version: null });
      expect((await me(cookie)).body.customer.consent_required).toBe(true);

      const consent = await request(app)
        .post('/api/customers/me/consent')
        .set('Cookie', cookie)
        .send({ privacy_consent: true, privacy_consent_version: 'dev-draft' });
      expect(consent.body.customer.consent_required).toBe(false);
      expect((await customerByEmail(email)).privacy_consent_version).toBe('dev-draft');
    });
  });

  describe('password reset', () => {
    const request_ = (email: string) => request(app).post('/api/customers/password-reset/request').send({ email });
    const confirm = (email: string, code: string, new_password: string) =>
      request(app).post('/api/customers/password-reset/confirm').send({ email, code, new_password });

    it('changes the password with the code, ends every session, and clears a lock', async () => {
      const { cookie, email } = await registered();
      await suite().db('customers').where({ email }).update({ failed_login_attempts: 5, locked_until: new Date(Date.now() + 600000) });

      expect((await request_(email)).status).toBe(200);
      const res = await confirm(email, lastCode(email, 'password_reset'), NEW_PASSWORD);

      expect(res.status).toBe(200);
      expect((await me(cookie)).status).toBe(401);
      expect((await login(email, PASSWORD)).status).toBe(401);
      expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('does not mail a stranger, and answers the same', async () => {
      await registered();

      const known = await request_('buyer@example.com');
      const unknown = await request_('nobody@example.com');

      expect(unknown.status).toBe(known.status);
      expect(unknown.body.message).toBe(known.body.message);
      expect(mailed.mock.calls.filter(call => call[0] === 'nobody@example.com')).toHaveLength(0);
    });

    it('needs the right code, and a sign-up code does not work for a reset', async () => {
      const { email } = await registered();
      await request_(email);

      expect((await confirm(email, '12a456', NEW_PASSWORD)).status).toBe(400);
      const wrong = lastCode(email, 'password_reset') === '000000' ? '111111' : '000000';
      expect((await confirm(email, wrong, NEW_PASSWORD)).body.code).toBe('INVALID_CODE');
      expect((await login(email, NEW_PASSWORD)).status).toBe(401);
      expect((await login(email, PASSWORD)).status).toBe(200);
    });

    it('verifies the e-mail of an account that never finished the sign-up, since the code reached the inbox', async () => {
      await signup();
      await request_('buyer@example.com');

      await confirm('buyer@example.com', lastCode('buyer@example.com', 'password_reset'), NEW_PASSWORD);

      expect((await customerByEmail('buyer@example.com')).email_verified_at).toBeInstanceOf(Date);
      expect((await login('buyer@example.com', NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe('Google and Kakao', () => {
    const social = (profile: Record<string, unknown>) => (fetchSocialProfile as unknown as jest.Mock).mockResolvedValue(profile);

    // The whole round trip: start, then the callback with the cookie and the state of the start.
    const roundTrip = async (provider: 'google' | 'kakao') => {
      config.oauth[provider] = { clientId: `${provider}-id`, clientSecret: 'secret' };
      const started = await request(app).get(`/api/customers/oauth/${provider}/start`).query({ next: '/estimate.html' });
      const state = new URL(started.headers.location).searchParams.get('state')!;
      const stateCookie = (started.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('bp_oauth='))!.split(';')[0];
      return request(app).get(`/api/customers/oauth/${provider}/callback`).query({ code: 'abc', state }).set('Cookie', stateCookie);
    };

    it('creates a verified account without a password for a new Google user, who still has to give the consent', async () => {
      social({ provider: 'google', providerUserId: 'g-1', email: 'new@example.com', name: 'New User' });

      const res = await roundTrip('google');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login.html?step=consent');
      const row = await customerByEmail('new@example.com');
      expect(row).toMatchObject({ name: 'New User', password_hash: null, privacy_consent_at: null });
      expect(row.email_verified_at).toBeInstanceOf(Date);
      const found = await me(sessionCookie(res));
      expect(found.status).toBe(200);
      expect(found.body.customer).toMatchObject({ has_password: false, providers: ['google'], consent_required: true });
    });

    it('recognises the same Google user the next time, and does not ask for the consent again once given', async () => {
      social({ provider: 'google', providerUserId: 'g-1', email: 'new@example.com', name: 'New User' });
      const first = await roundTrip('google');
      await request(app)
        .post('/api/customers/me/consent')
        .set('Cookie', sessionCookie(first))
        .send({ privacy_consent: true, privacy_consent_version: 'dev-draft' });

      const second = await roundTrip('google');

      expect(second.headers.location).toBe(`${config.frontendBaseUrl}/estimate.html`);
      expect(await customers()).toHaveLength(1);
      expect(await suite().db('customer_identities').count({ n: '*' }).first()).toMatchObject({ n: '1' });
    });

    it('adds Kakao to an existing verified account with the same e-mail', async () => {
      await registered();
      social({ provider: 'kakao', providerUserId: 'k-1', email: 'buyer@example.com', name: 'Nick' });

      const res = await roundTrip('kakao');

      expect(res.headers.location).toBe(`${config.frontendBaseUrl}/estimate.html`);
      expect(await customers()).toHaveLength(1);
      const found = await me(sessionCookie(res));
      expect(found.body.customer).toMatchObject({ has_password: true, providers: ['kakao'], name: 'Kim' });
      expect((await login('buyer@example.com', PASSWORD)).status).toBe(200);
    });

    it('takes the password away from an unverified sign-up when the owner of the address arrives through Google', async () => {
      await signup({ password: 'squatter-pass-1' });
      social({ provider: 'google', providerUserId: 'g-7', email: 'buyer@example.com' });

      await roundTrip('google');

      const row = await customerByEmail('buyer@example.com');
      expect(row.password_hash).toBeNull();
      expect(row.email_verified_at).toBeInstanceOf(Date);
      expect((await login('buyer@example.com', 'squatter-pass-1')).status).toBe(401);
    });

    it('refuses a second Google account for an account that already has one', async () => {
      social({ provider: 'google', providerUserId: 'g-1', email: 'buyer@example.com' });
      await roundTrip('google');
      social({ provider: 'google', providerUserId: 'g-2', email: 'buyer@example.com' });

      const res = await roundTrip('google');

      expect(res.headers.location).toContain('error=account_blocked');
      expect(cookieValueOf(res, 'bp_session')).toBeUndefined();
      expect(await suite().db('customer_identities').count({ n: '*' }).first()).toMatchObject({ n: '1' });
    });

    it('refuses an inactive account', async () => {
      social({ provider: 'google', providerUserId: 'g-1', email: 'buyer@example.com' });
      await roundTrip('google');
      await suite().db('customers').update({ is_active: false });

      const res = await roundTrip('google');

      expect(res.headers.location).toContain('error=account_blocked');
    });

    it('lets a Google-only account set a password through the reset', async () => {
      social({ provider: 'google', providerUserId: 'g-1', email: 'buyer@example.com' });
      await roundTrip('google');

      await request(app).post('/api/customers/password-reset/request').send({ email: 'buyer@example.com' });
      const res = await request(app)
        .post('/api/customers/password-reset/confirm')
        .send({ email: 'buyer@example.com', code: lastCode('buyer@example.com', 'password_reset'), new_password: NEW_PASSWORD });

      expect(res.status).toBe(200);
      expect((await login('buyer@example.com', NEW_PASSWORD)).status).toBe(200);
    });
  });
});
