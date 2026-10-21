import crypto from 'crypto';
import { config } from '../config/env';
import { BCRYPT_MAX_PASSWORD_BYTES, passwordByteLength } from './hash';
import { CUSTOMER_LIMITS, CUSTOMER_TYPES, SubmittedCustomerType } from './customerValidation';

// Rules for customer accounts that need no database: the shape of the input, the password rules,
// the 6-digit e-mail code and the address a login may send the browser back to.

export interface FieldError {
  field: string;
  message: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[0-9+\-()\s]+$/;

export const CUSTOMER_PASSWORD_MIN_CHARACTERS = 8;

// The e-mail is the account name: compared in lowercase, so "A@x.com" and "a@x.com" are one account.
export function normalizeEmail(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (value === '' || value.length > CUSTOMER_LIMITS.email || CONTROL_CHARS.test(value) || !EMAIL_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

// At least 8 characters with a letter and a digit, at most 72 bytes (bcrypt reads no more).
export function checkPassword(password: unknown, email?: string): FieldError | undefined {
  if (typeof password !== 'string' || password === '') {
    return { field: 'password', message: 'is required' };
  }
  if (passwordByteLength(password) > BCRYPT_MAX_PASSWORD_BYTES) {
    return { field: 'password', message: `must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes` };
  }
  if (Array.from(password).length < CUSTOMER_PASSWORD_MIN_CHARACTERS) {
    return { field: 'password', message: `must have at least ${CUSTOMER_PASSWORD_MIN_CHARACTERS} characters` };
  }
  if (CONTROL_CHARS.test(password)) {
    return { field: 'password', message: 'contains invalid control characters' };
  }
  if (!/\p{L}/u.test(password) || !/[0-9]/.test(password)) {
    return { field: 'password', message: 'must contain a letter and a digit' };
  }
  if (email && (password.toLowerCase() === email || password.toLowerCase() === email.split('@')[0])) {
    return { field: 'password', message: 'must not be the e-mail address' };
  }
  return undefined;
}

export interface SignupProfile {
  name: string;
  phone?: string;
  company_name?: string;
  customer_type?: SubmittedCustomerType;
}

function text(raw: unknown, field: string, max: number, errors: FieldError[]): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return undefined;
  }
  const value = raw.trim();
  if (value === '') {
    return undefined;
  }
  if (CONTROL_CHARS.test(value)) {
    errors.push({ field, message: 'contains invalid control characters' });
    return undefined;
  }
  if (value.length > max) {
    errors.push({ field, message: `must be at most ${max} characters` });
    return undefined;
  }
  return value;
}

export function validateProfile(
  input: { name?: unknown; phone?: unknown; company_name?: unknown; customer_type?: unknown },
  options: { nameRequired: boolean; phoneRequired?: boolean }
): { valid: true; value: Partial<SignupProfile> } | { valid: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const name = text(input.name, 'name', CUSTOMER_LIMITS.name, errors);
  const phone = text(input.phone, 'phone', CUSTOMER_LIMITS.phone, errors);
  const company = text(input.company_name, 'company_name', CUSTOMER_LIMITS.company, errors);

  if (options.nameRequired && name === undefined && !errors.some(e => e.field === 'name')) {
    errors.push({ field: 'name', message: 'is required' });
  }
  if (options.phoneRequired && phone === undefined && !errors.some(e => e.field === 'phone')) {
    errors.push({ field: 'phone', message: 'is required' });
  }
  if (phone !== undefined) {
    const digits = phone.replace(/\D/g, '').length;
    if (!PHONE_CHARS.test(phone) || digits < 7 || digits > 15) {
      errors.push({ field: 'phone', message: 'must contain 7-15 digits and only digits, spaces, +, -, ( )' });
    }
  }

  let customerType: SubmittedCustomerType | undefined;
  if (input.customer_type !== undefined && input.customer_type !== null && input.customer_type !== '') {
    if (typeof input.customer_type === 'string' && (CUSTOMER_TYPES as readonly string[]).includes(input.customer_type)) {
      customerType = input.customer_type as SubmittedCustomerType;
    } else {
      errors.push({ field: 'customer_type', message: 'must be individual_startup or business_brand' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: { name, phone, company_name: company, customer_type: customerType } };
}

// ---------------------------------------------------------------------------------------------
// The e-mail code. 6 digits, valid for 10 minutes, 5 wrong tries, one new code a minute.

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_WAIT_MS = 60 * 1000;

export function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

export function isCodeFormat(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(value);
}

// Keyed with the server secret and bound to the account and the purpose, so a stolen row does
// not give the code and a code for one purpose does not work for another.
export function hashCode(code: string, customerId: string, purpose: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${purpose}:${customerId}:${code}`).digest('hex');
}

export function codesMatch(expectedHash: string, actualHash: string): boolean {
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(actualHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------------------------
// Sessions: the cookie holds a random token, the database only its hash.

export const SESSION_COOKIE = 'bp_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function newSessionToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isSessionTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

// ---------------------------------------------------------------------------------------------
// Where a login may send the browser back to: a page of this site, never another address.

export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) {
    return fallback;
  }
  // One leading slash, and nothing that a browser reads as another host ("//x", "/\x") or as a script.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || CONTROL_CHARS.test(raw)) {
    return fallback;
  }
  try {
    const parsed = new URL(raw, 'http://placeholder.invalid');
    if (parsed.origin !== 'http://placeholder.invalid') {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return raw;
}
