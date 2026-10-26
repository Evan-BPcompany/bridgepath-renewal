import { Pool } from 'pg';
import { getPool } from '../config/database';
import { comparePassword, hashPassword } from '../utils/hash';
import { evaluateLockout } from '../utils/loginLockout';
import { recordFailedLogin } from './loginAttempts';
import {
  CODE_MAX_ATTEMPTS,
  CODE_RESEND_WAIT_MS,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  SignupProfile,
  codesMatch,
  generateCode,
  hashCode,
  hashSessionToken,
  newSessionToken
} from '../utils/customerAccount';
import { CodePurpose } from './customerMailer';

export type CustomerAuthCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'EMAIL_NOT_VERIFIED'
  | 'INVALID_CODE'
  | 'CODE_EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'CODE_TOO_SOON'
  | 'NOT_FOUND';

export class CustomerAuthError extends Error {
  constructor(
    public readonly code: CustomerAuthCode,
    public readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = 'CustomerAuthError';
  }
}

export interface PublicCustomer {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  company_name: string | null;
  customer_type: string | null;
  has_password: boolean;
  providers: string[];
  consent_required: boolean;
  // The mobile phone is asked at sign-up; an account made with Google/Kakao has none until it is given.
  phone_required: boolean;
  // Agreed to KakaoTalk notices (a separate consent; can be taken back).
  kakao_notify: boolean;
}

export interface SessionContext {
  ip?: string;
  userAgent?: string;
}

type Row = Record<string, any>;

const CUSTOMER_COLUMNS = `id, email, password_hash, name, phone, company_name, customer_type,
  email_verified_at, privacy_consent_at, kakao_notify_consent_at, is_active, failed_login_attempts, locked_until`;

// A login for an unknown e-mail still pays for one bcrypt comparison, so the answer does not come
// back faster than for a known one. The hash is made once, on first use.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(`not-a-real-password-${Date.now()}`);
  return dummyHash;
}

export function toPublicCustomer(row: Row, providers: string[] = []): PublicCustomer {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    phone: row.phone ?? null,
    company_name: row.company_name ?? null,
    customer_type: row.customer_type ?? null,
    has_password: Boolean(row.password_hash),
    providers,
    consent_required: !row.privacy_consent_at,
    phone_required: !row.phone,
    kakao_notify: Boolean(row.kakao_notify_consent_at)
  };
}

async function providersOf(pool: Pool, customerId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT provider FROM customer_identities WHERE customer_id = $1 ORDER BY provider`,
    [customerId]
  );
  return result.rows.map((row: Row) => row.provider);
}

export async function loadPublicCustomer(customerId: string): Promise<PublicCustomer | undefined> {
  const pool = getPool();
  const result = await pool.query(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE id = $1`, [customerId]);
  const row = result.rows[0];
  return row ? toPublicCustomer(row, await providersOf(pool, customerId)) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Sign-up

export interface SignupInput {
  email: string;
  password: string;
  profile: SignupProfile;
  consentVersion: string;
  kakaoNotify?: boolean;
}

// Creates the account, still unverified, or takes over an unverified one for the same e-mail: nobody
// has proven that address yet, so the newest sign-up wins. A verified account is never touched.
export async function signup(input: SignupInput): Promise<{ customerId: string }> {
  const pool = getPool();
  const passwordHash = await hashPassword(input.password);
  const { profile } = input;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await pool.query(`SELECT id, email_verified_at FROM customers WHERE email = $1`, [input.email]);
    if (existing.rows[0]?.email_verified_at) {
      throw new CustomerAuthError('EMAIL_TAKEN');
    }

    if (existing.rows[0]) {
      const updated = await pool.query(
        `UPDATE customers
         SET password_hash = $2, name = $3, phone = $4, company_name = $5, customer_type = $6,
             privacy_consent_at = CURRENT_TIMESTAMP, privacy_consent_version = $7,
             kakao_notify_consent_at = CASE WHEN $8::boolean THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND email_verified_at IS NULL
         RETURNING id`,
        [
          existing.rows[0].id,
          passwordHash,
          profile.name,
          profile.phone ?? null,
          profile.company_name ?? null,
          profile.customer_type ?? null,
          input.consentVersion,
          input.kakaoNotify === true
        ]
      );
      if (updated.rows[0]) {
        return { customerId: updated.rows[0].id };
      }
      continue; // verified in the meantime: look again
    }

    try {
      const inserted = await pool.query(
        `INSERT INTO customers (email, password_hash, name, phone, company_name, customer_type,
                                privacy_consent_at, privacy_consent_version, kakao_notify_consent_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, CASE WHEN $8::boolean THEN CURRENT_TIMESTAMP ELSE NULL END)
         RETURNING id`,
        [
          input.email,
          passwordHash,
          profile.name,
          profile.phone ?? null,
          profile.company_name ?? null,
          profile.customer_type ?? null,
          input.consentVersion,
          input.kakaoNotify === true
        ]
      );
      return { customerId: inserted.rows[0].id };
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') {
        throw err;
      }
      // Someone signed up with the same e-mail at the same moment: look again.
    }
  }
  throw new CustomerAuthError('EMAIL_TAKEN');
}

export async function findCustomerByEmail(
  email: string
): Promise<{ id: string; verified: boolean; active: boolean } | undefined> {
  const result = await getPool().query(`SELECT id, email_verified_at, is_active FROM customers WHERE email = $1`, [email]);
  const row = result.rows[0];
  return row ? { id: row.id, verified: Boolean(row.email_verified_at), active: row.is_active === true } : undefined;
}

// ---------------------------------------------------------------------------------------------
// E-mail codes

// Makes a new code for the account and purpose. One new code per minute: the row is only replaced
// when the last one is old enough, in one statement, so parallel requests cannot all pass.
export async function issueCode(customerId: string, purpose: CodePurpose, now = new Date()): Promise<string> {
  const pool = getPool();
  const code = generateCode();
  const result = await pool.query(
    `INSERT INTO customer_email_codes (customer_id, purpose, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, $4, $5)
     ON CONFLICT (customer_id, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at
       WHERE customer_email_codes.created_at <= $5::timestamptz - ($6 * interval '1 millisecond')
     RETURNING customer_id`,
    [
      customerId,
      purpose,
      hashCode(code, customerId, purpose),
      new Date(now.getTime() + CODE_TTL_MS),
      now,
      CODE_RESEND_WAIT_MS
    ]
  );

  if (result.rows.length === 0) {
    const last = await pool.query(
      `SELECT created_at FROM customer_email_codes WHERE customer_id = $1 AND purpose = $2`,
      [customerId, purpose]
    );
    const createdAt = last.rows[0] ? new Date(last.rows[0].created_at).getTime() : now.getTime();
    const wait = Math.max(1, Math.ceil((createdAt + CODE_RESEND_WAIT_MS - now.getTime()) / 1000));
    throw new CustomerAuthError('CODE_TOO_SOON', wait);
  }
  return code;
}

// Checks a code. A right code is used up; a wrong one counts, and after 5 wrong ones the code is gone.
export async function consumeCode(
  customerId: string,
  purpose: CodePurpose,
  code: string,
  now = new Date()
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  let outcome: CustomerAuthCode | undefined;

  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT code_hash, attempts, expires_at FROM customer_email_codes
       WHERE customer_id = $1 AND purpose = $2 FOR UPDATE`,
      [customerId, purpose]
    );
    const row = found.rows[0];

    if (!row) {
      outcome = 'INVALID_CODE';
    } else if (new Date(row.expires_at).getTime() <= now.getTime()) {
      await client.query(`DELETE FROM customer_email_codes WHERE customer_id = $1 AND purpose = $2`, [customerId, purpose]);
      outcome = 'CODE_EXPIRED';
    } else if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await client.query(`DELETE FROM customer_email_codes WHERE customer_id = $1 AND purpose = $2`, [customerId, purpose]);
      outcome = 'TOO_MANY_ATTEMPTS';
    } else if (!codesMatch(row.code_hash, hashCode(code, customerId, purpose))) {
      const attempts = row.attempts + 1;
      if (attempts >= CODE_MAX_ATTEMPTS) {
        await client.query(`DELETE FROM customer_email_codes WHERE customer_id = $1 AND purpose = $2`, [customerId, purpose]);
        outcome = 'TOO_MANY_ATTEMPTS';
      } else {
        await client.query(
          `UPDATE customer_email_codes SET attempts = $3 WHERE customer_id = $1 AND purpose = $2`,
          [customerId, purpose, attempts]
        );
        outcome = 'INVALID_CODE';
      }
    } else {
      await client.query(`DELETE FROM customer_email_codes WHERE customer_id = $1 AND purpose = $2`, [customerId, purpose]);
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be unusable; the original error is rethrown below.
    }
    throw err;
  } finally {
    client.release();
  }

  if (outcome) {
    throw new CustomerAuthError(outcome);
  }
}

// The sign-up code was right: the address is now proven. Returns false for an account that does not exist.
export async function markEmailVerified(customerId: string): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE customers SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND is_active = true RETURNING id`,
    [customerId]
  );
  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Sessions

export async function createSession(customerId: string, context: SessionContext, now = new Date()): Promise<string> {
  const { token, hash } = newSessionToken();
  await getPool().query(
    `INSERT INTO customer_sessions (customer_id, token_hash, user_agent, ip_address, created_at, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6)`,
    [
      customerId,
      hash,
      context.userAgent ? context.userAgent.slice(0, 255) : null,
      context.ip ? context.ip.slice(0, 64) : null,
      now,
      new Date(now.getTime() + SESSION_TTL_MS)
    ]
  );
  return token;
}

export interface SessionCustomer {
  customer: PublicCustomer;
  sessionId: string;
}

export async function findSessionCustomer(token: string, now = new Date()): Promise<SessionCustomer | undefined> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT s.id AS session_id, c.id, c.email, c.password_hash, c.name, c.phone, c.company_name, c.customer_type,
            c.privacy_consent_at, c.kakao_notify_consent_at
     FROM customer_sessions s
     JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
       AND c.is_active = true AND c.email_verified_at IS NOT NULL`,
    [hashSessionToken(token), now]
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  return { customer: toPublicCustomer(row, await providersOf(pool, row.id)), sessionId: row.session_id };
}

export async function revokeSession(token: string): Promise<void> {
  await getPool().query(
    `UPDATE customer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSessionToken(token)]
  );
}

export async function revokeAllSessions(customerId: string): Promise<void> {
  await getPool().query(
    `UPDATE customer_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE customer_id = $1 AND revoked_at IS NULL`,
    [customerId]
  );
}

// ---------------------------------------------------------------------------------------------
// Password login

export async function loginWithPassword(email: string, password: string, now = new Date()): Promise<{ customerId: string }> {
  const pool = getPool();
  const result = await pool.query(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE email = $1`, [email]);
  const row: Row | undefined = result.rows[0];

  if (!row || !row.is_active || !row.password_hash) {
    await comparePassword(password, await getDummyHash());
    throw new CustomerAuthError('INVALID_CREDENTIALS');
  }

  if (evaluateLockout(row as never, now).status === 'locked') {
    throw new CustomerAuthError('ACCOUNT_LOCKED');
  }

  if (!(await comparePassword(password, row.password_hash))) {
    await recordFailedLogin(pool, row.id, now, 'customers');
    throw new CustomerAuthError('INVALID_CREDENTIALS');
  }

  // Said only to someone who knows the password, so it does not tell strangers which e-mails exist.
  if (!row.email_verified_at) {
    throw new CustomerAuthError('EMAIL_NOT_VERIFIED');
  }

  await pool.query(
    `UPDATE customers SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [row.id]
  );
  return { customerId: row.id };
}

// ---------------------------------------------------------------------------------------------
// Password reset

// A new password after the reset code was right. Every session of the account ends.
export async function setPassword(customerId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await getPool().query(
    `UPDATE customers
     SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL,
         email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [customerId, passwordHash]
  );
  await revokeAllSessions(customerId);
}

// ---------------------------------------------------------------------------------------------
// Google / Kakao

export interface SocialProfile {
  provider: 'google' | 'kakao';
  providerUserId: string;
  email: string;
  name?: string;
}

// The provider has said who this is and that the e-mail belongs to them:
//   known identity            -> that account
//   same e-mail, an account   -> the identity is added to it (an unverified password sign-up for that
//                                e-mail loses its password: the one who typed it never proved the address)
//   otherwise                 -> a new, verified account without a password
export async function loginWithSocial(profile: SocialProfile): Promise<{ customerId: string; created: boolean }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const known = await client.query(
      `SELECT i.customer_id, c.is_active FROM customer_identities i JOIN customers c ON c.id = i.customer_id
       WHERE i.provider = $1 AND i.provider_user_id = $2`,
      [profile.provider, profile.providerUserId]
    );
    if (known.rows[0]) {
      await client.query('COMMIT');
      if (!known.rows[0].is_active) {
        throw new CustomerAuthError('INVALID_CREDENTIALS');
      }
      return { customerId: known.rows[0].customer_id, created: false };
    }

    // The row is locked so a password sign-up or reset for the same e-mail cannot interleave.
    const byEmail = await client.query(
      `SELECT id, is_active, email_verified_at FROM customers WHERE email = $1 FOR UPDATE`,
      [profile.email]
    );
    let customerId: string;
    let created = false;

    if (byEmail.rows[0]) {
      if (!byEmail.rows[0].is_active) {
        throw new CustomerAuthError('INVALID_CREDENTIALS');
      }
      customerId = byEmail.rows[0].id;
      if (!byEmail.rows[0].email_verified_at) {
        await client.query(
          `UPDATE customers SET password_hash = NULL, email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [customerId]
        );
      }
    } else {
      const inserted = await client.query(
        `INSERT INTO customers (email, name, email_verified_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`,
        [profile.email, profile.name ? profile.name.slice(0, 100) : null]
      );
      customerId = inserted.rows[0].id;
      created = true;
    }

    // One identity per provider and account: a different Google account for the same customer is refused.
    const linked = await client.query(
      `INSERT INTO customer_identities (customer_id, provider, provider_user_id, email)
       VALUES ($1, $2, $3, $4) ON CONFLICT (customer_id, provider) DO NOTHING RETURNING id`,
      [customerId, profile.provider, profile.providerUserId, profile.email]
    );
    if (linked.rows.length === 0) {
      throw new CustomerAuthError('INVALID_CREDENTIALS');
    }

    await client.query('COMMIT');
    return { customerId, created };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Already finished or the connection is gone; the original error is rethrown.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// The account itself

export async function recordConsent(customerId: string, version: string): Promise<void> {
  await getPool().query(
    `UPDATE customers SET privacy_consent_at = CURRENT_TIMESTAMP, privacy_consent_version = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [customerId, version]
  );
}

// The consent to KakaoTalk notices: given at sign-up or later, and taken back at any time.
export async function setKakaoNotify(customerId: string, on: boolean): Promise<void> {
  await getPool().query(
    `UPDATE customers
     SET kakao_notify_consent_at = CASE WHEN $2::boolean THEN COALESCE(kakao_notify_consent_at, CURRENT_TIMESTAMP) ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [customerId, on]
  );
}

export async function updateProfile(
  customerId: string,
  profile: Partial<SignupProfile>
): Promise<PublicCustomer | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [customerId];
  const add = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (profile.name !== undefined) add('name', profile.name);
  if (profile.phone !== undefined) add('phone', profile.phone);
  if (profile.company_name !== undefined) add('company_name', profile.company_name);
  if (profile.customer_type !== undefined) add('customer_type', profile.customer_type);

  if (sets.length > 0) {
    await getPool().query(`UPDATE customers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, params);
  }
  return loadPublicCustomer(customerId);
}
