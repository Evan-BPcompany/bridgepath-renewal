import crypto from 'crypto';
import { config } from '../config/env';
import { SocialProfile } from './customerAuthService';

// Google and Kakao sign-in by the authorization code flow, done on the server: the browser only
// carries the one-time code back, and the server exchanges it for the profile over TLS.

export type Provider = 'google' | 'kakao';
export const PROVIDERS: readonly Provider[] = ['google', 'kakao'];

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

export type OAuthErrorCode = 'PROVIDER_ERROR' | 'EMAIL_MISSING' | 'EMAIL_NOT_VERIFIED';

export class OAuthError extends Error {
  constructor(public readonly code: OAuthErrorCode) {
    super(code);
    this.name = 'OAuthError';
  }
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

const REQUEST_TIMEOUT_MS = 10000;

export function isProviderEnabled(provider: Provider): boolean {
  return Boolean(config.oauth[provider]);
}

export function redirectUri(provider: Provider): string {
  return `${config.publicApiUrl}/api/customers/oauth/${provider}/callback`;
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

export function buildAuthorizeUrl(provider: Provider, state: string, challenge: string): string {
  const settings = config.oauth[provider];
  if (!settings) {
    throw new OAuthError('PROVIDER_ERROR');
  }

  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    state
  });

  if (provider === 'google') {
    params.set('scope', 'openid email profile');
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', 'S256');
    params.set('prompt', 'select_account');
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  params.set('scope', 'account_email profile_nickname');
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

async function request(fetchImpl: FetchLike, url: string, init: Record<string, unknown>): Promise<Record<string, any>> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = (await response.json()) as Record<string, any>;
    if (!response.ok || !body || typeof body !== 'object') {
      throw new OAuthError('PROVIDER_ERROR');
    }
    return body;
  } catch (err) {
    throw err instanceof OAuthError ? err : new OAuthError('PROVIDER_ERROR');
  }
}

const form = (values: Record<string, string>): Record<string, unknown> => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams(values).toString()
});

const bearer = (token: string): Record<string, unknown> => ({
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
});

// The one-time code in, the profile out. The e-mail must be one the provider has verified.
export async function fetchSocialProfile(
  provider: Provider,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike
): Promise<SocialProfile> {
  const settings = config.oauth[provider];
  if (!settings) {
    throw new OAuthError('PROVIDER_ERROR');
  }

  if (provider === 'google') {
    const token = await request(
      fetchImpl,
      'https://oauth2.googleapis.com/token',
      form({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret ?? '',
        redirect_uri: redirectUri('google'),
        grant_type: 'authorization_code',
        code_verifier: codeVerifier
      })
    );
    if (typeof token.access_token !== 'string') {
      throw new OAuthError('PROVIDER_ERROR');
    }

    const me = await request(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', bearer(token.access_token));
    if (typeof me.sub !== 'string' || me.sub === '') {
      throw new OAuthError('PROVIDER_ERROR');
    }
    if (typeof me.email !== 'string' || me.email === '') {
      throw new OAuthError('EMAIL_MISSING');
    }
    if (me.email_verified !== true) {
      throw new OAuthError('EMAIL_NOT_VERIFIED');
    }
    return {
      provider,
      providerUserId: me.sub,
      email: me.email.trim().toLowerCase(),
      name: typeof me.name === 'string' ? me.name : undefined
    };
  }

  const values: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: settings.clientId,
    redirect_uri: redirectUri('kakao'),
    code
  };
  if (settings.clientSecret) {
    values.client_secret = settings.clientSecret;
  }
  const token = await request(fetchImpl, 'https://kauth.kakao.com/oauth/token', form(values));
  if (typeof token.access_token !== 'string') {
    throw new OAuthError('PROVIDER_ERROR');
  }

  const me = await request(fetchImpl, 'https://kapi.kakao.com/v2/user/me', bearer(token.access_token));
  if (me.id === undefined || me.id === null || String(me.id) === '') {
    throw new OAuthError('PROVIDER_ERROR');
  }
  const account = (me.kakao_account ?? {}) as Record<string, any>;
  if (typeof account.email !== 'string' || account.email === '') {
    throw new OAuthError('EMAIL_MISSING');
  }
  if (account.is_email_valid !== true || account.is_email_verified !== true) {
    throw new OAuthError('EMAIL_NOT_VERIFIED');
  }
  const nickname = account.profile && typeof account.profile.nickname === 'string' ? account.profile.nickname : undefined;
  return {
    provider,
    providerUserId: String(me.id),
    email: account.email.trim().toLowerCase(),
    name: nickname
  };
}
