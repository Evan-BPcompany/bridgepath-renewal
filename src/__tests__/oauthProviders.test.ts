import { config } from '../config/env';
import {
  OAuthError,
  buildAuthorizeUrl,
  fetchSocialProfile,
  isProvider,
  isProviderEnabled,
  newPkce,
  redirectUri
} from '../services/oauthProviders';
import crypto from 'crypto';

type Answer = { ok?: boolean; body: unknown };

// A fetch that answers by address and remembers what it was asked.
function fakeFetch(answers: Record<string, Answer>) {
  const calls: Array<{ url: string; init: Record<string, any> }> = [];
  const impl = jest.fn(async (url: string, init: Record<string, unknown> = {}) => {
    calls.push({ url, init: init as Record<string, any> });
    const answer = answers[url];
    if (!answer) {
      throw new Error(`unexpected ${url}`);
    }
    return { ok: answer.ok !== false, json: async () => answer.body };
  });
  return { impl, calls };
}

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ME = 'https://openidconnect.googleapis.com/v1/userinfo';
const KAKAO_TOKEN = 'https://kauth.kakao.com/oauth/token';
const KAKAO_ME = 'https://kapi.kakao.com/v2/user/me';

describe('Google and Kakao sign-in', () => {
  const original = { ...config.oauth };

  beforeEach(() => {
    config.oauth.google = { clientId: 'google-id', clientSecret: 'google-secret' };
    config.oauth.kakao = { clientId: 'kakao-id' };
  });

  afterAll(() => {
    config.oauth.google = original.google;
    config.oauth.kakao = original.kakao;
  });

  it('knows its two providers and nothing else', () => {
    expect(isProvider('google')).toBe(true);
    expect(isProvider('kakao')).toBe(true);
    expect(isProvider('naver')).toBe(false);
    expect(isProvider(undefined)).toBe(false);
  });

  it('is on for a provider only when its client id is set', () => {
    expect(isProviderEnabled('google')).toBe(true);
    config.oauth.kakao = undefined;
    expect(isProviderEnabled('kakao')).toBe(false);
  });

  it('sends the customer back to this API, to the callback of the provider', () => {
    expect(redirectUri('google')).toBe(`${config.publicApiUrl}/api/customers/oauth/google/callback`);
    expect(redirectUri('kakao')).toBe(`${config.publicApiUrl}/api/customers/oauth/kakao/callback`);
  });

  it('builds the Google address with state and a PKCE challenge, asking for the e-mail', () => {
    const pkce = newPkce();
    const url = new URL(buildAuthorizeUrl('google', 'the-state', pkce.challenge));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'google-id',
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      state: 'the-state',
      scope: 'openid email profile',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
  });

  it('builds the Kakao address with state and the e-mail scope', () => {
    const url = new URL(buildAuthorizeUrl('kakao', 'the-state', 'ignored'));

    expect(url.origin + url.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'kakao-id',
      redirect_uri: redirectUri('kakao'),
      response_type: 'code',
      state: 'the-state',
      scope: 'account_email profile_nickname'
    });
  });

  it('refuses to build an address for a provider that is off', () => {
    config.oauth.google = undefined;
    expect(() => buildAuthorizeUrl('google', 's', 'c')).toThrow(OAuthError);
  });

  it('makes a PKCE pair whose challenge is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = newPkce();

    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
    expect(newPkce().verifier).not.toBe(verifier);
  });

  describe('Google profile', () => {
    const goodAnswers = (me: Record<string, unknown>): Record<string, Answer> => ({
      [GOOGLE_TOKEN]: { body: { access_token: 'google-access' } },
      [GOOGLE_ME]: { body: me }
    });

    it('exchanges the code (with the verifier and the secret) and reads the profile', async () => {
      const { impl, calls } = fakeFetch(goodAnswers({ sub: '1234', email: 'Buyer@Example.com', email_verified: true, name: 'Kim' }));

      const profile = await fetchSocialProfile('google', 'the-code', 'the-verifier', impl);

      expect(profile).toEqual({ provider: 'google', providerUserId: '1234', email: 'buyer@example.com', name: 'Kim' });
      expect(calls[0].init.method).toBe('POST');
      expect(Object.fromEntries(new URLSearchParams(calls[0].init.body))).toEqual({
        code: 'the-code',
        client_id: 'google-id',
        client_secret: 'google-secret',
        redirect_uri: redirectUri('google'),
        grant_type: 'authorization_code',
        code_verifier: 'the-verifier'
      });
      expect(calls[1].init.headers.Authorization).toBe('Bearer google-access');
    });

    it('refuses an e-mail that Google has not verified', async () => {
      const { impl } = fakeFetch(goodAnswers({ sub: '1', email: 'a@b.com', email_verified: false }));
      await expect(fetchSocialProfile('google', 'c', 'v', impl)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('refuses a profile without an e-mail or without an id', async () => {
      await expect(fetchSocialProfile('google', 'c', 'v', fakeFetch(goodAnswers({ sub: '1' })).impl)).rejects.toMatchObject({
        code: 'EMAIL_MISSING'
      });
      await expect(
        fetchSocialProfile('google', 'c', 'v', fakeFetch(goodAnswers({ email: 'a@b.com', email_verified: true })).impl)
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });

    it('turns a refusal of the code, a missing token and a network error into PROVIDER_ERROR', async () => {
      await expect(
        fetchSocialProfile('google', 'c', 'v', fakeFetch({ [GOOGLE_TOKEN]: { ok: false, body: { error: 'invalid_grant' } } }).impl)
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      await expect(
        fetchSocialProfile('google', 'c', 'v', fakeFetch({ [GOOGLE_TOKEN]: { body: {} } }).impl)
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      await expect(
        fetchSocialProfile('google', 'c', 'v', jest.fn().mockRejectedValue(new Error('socket hang up')))
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
  });

  describe('Kakao profile', () => {
    const goodAnswers = (me: Record<string, unknown>): Record<string, Answer> => ({
      [KAKAO_TOKEN]: { body: { access_token: 'kakao-access' } },
      [KAKAO_ME]: { body: me }
    });
    const account = (extra: Record<string, unknown> = {}) => ({
      email: 'Buyer@Kakao.com',
      is_email_valid: true,
      is_email_verified: true,
      profile: { nickname: 'Nick' },
      ...extra
    });

    it('exchanges the code (no secret when none is set) and reads the profile', async () => {
      const { impl, calls } = fakeFetch(goodAnswers({ id: 987654321, kakao_account: account() }));

      const profile = await fetchSocialProfile('kakao', 'the-code', 'unused', impl);

      expect(profile).toEqual({ provider: 'kakao', providerUserId: '987654321', email: 'buyer@kakao.com', name: 'Nick' });
      expect(Object.fromEntries(new URLSearchParams(calls[0].init.body))).toEqual({
        grant_type: 'authorization_code',
        client_id: 'kakao-id',
        redirect_uri: redirectUri('kakao'),
        code: 'the-code'
      });
    });

    it('sends the client secret when one is set', async () => {
      config.oauth.kakao = { clientId: 'kakao-id', clientSecret: 'kakao-secret' };
      const { impl, calls } = fakeFetch(goodAnswers({ id: 1, kakao_account: account() }));

      await fetchSocialProfile('kakao', 'c', 'v', impl);

      expect(new URLSearchParams(calls[0].init.body).get('client_secret')).toBe('kakao-secret');
    });

    it('refuses an account without a usable verified e-mail', async () => {
      await expect(
        fetchSocialProfile('kakao', 'c', 'v', fakeFetch(goodAnswers({ id: 1, kakao_account: { profile: {} } })).impl)
      ).rejects.toMatchObject({ code: 'EMAIL_MISSING' });
      await expect(
        fetchSocialProfile('kakao', 'c', 'v', fakeFetch(goodAnswers({ id: 1, kakao_account: account({ is_email_verified: false }) })).impl)
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      await expect(
        fetchSocialProfile('kakao', 'c', 'v', fakeFetch(goodAnswers({ id: 1, kakao_account: account({ is_email_valid: false }) })).impl)
      ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('refuses an answer without an id', async () => {
      await expect(
        fetchSocialProfile('kakao', 'c', 'v', fakeFetch(goodAnswers({ kakao_account: account() })).impl)
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
  });
});
