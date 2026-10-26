import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { createApp } from '../../app';

// Test data and small helpers shared by the integration suites. Passwords and tokens here
// are made up and only ever stored in the isolated test schema.

export const MASTER_ID = 'a0000000-0000-0000-0000-000000000001';
export const MASTER_USERNAME = 'master';
export const PASSWORD = 'Correct-Horse-9';
export const NEW_PASSWORD = 'Another-Passw0rd!';
export const WRONG_PASSWORD = 'Wrong-Horse-0000';

// What every valid estimate request carries besides the specification and a contact:
// customer type, name and privacy consent (the version is accepted outside production).
export const CUSTOMER_PROFILE = {
  customer_type: 'individual_startup',
  customer_name: 'Kim',
  privacy_consent: true,
  privacy_consent_version: 'dev-draft'
} as const;

export const SHOE_SPEC = {
  schema_version: '1.0',
  shoe_type: 'Running',
  material: 'Mesh',
  size_range: '240-250',
  quantity: 600
};

// Low cost: these hashes only exist to make logins fast in tests.
export const passwordHash = (password: string): string => bcrypt.hashSync(password, 4);

// The app with limits high enough that a test never trips them by accident.
export function createTestApp(): Express {
  const unlimited = { windowMs: 60_000, max: 100_000 };
  return createApp({
    rateLimits: {
      login: unlimited,
      api: unlimited,
      mutation: unlimited,
      password: unlimited,
      estimateCreate: unlimited,
      estimateRead: unlimited,
      estimatePreview: unlimited,
      imageAnalysis: unlimited,
      customerLogin: unlimited,
      customerSignup: unlimited,
      customerCode: unlimited,
      customerRead: unlimited,
      customerInquiry: unlimited
    }
  });
}

// Removes everything the suites create and restores the seeded master account, so each
// test starts from the state right after the migrations.
export async function resetData(db: Knex): Promise<void> {
  await db.raw(
    'TRUNCATE estimates, email_events, receipt_sequence, admin_sessions, customers RESTART IDENTITY CASCADE'
  );
  await db('admin_users').whereNot({ id: MASTER_ID }).del();
  await db('admin_users')
    .where({ id: MASTER_ID })
    .update({
      password_hash: passwordHash(PASSWORD),
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
      must_change_password: false
    });
}

export interface NewAdmin {
  username: string;
  role?: 'admin' | 'manager';
  password?: string;
  active?: boolean;
  mustChangePassword?: boolean;
}

export async function insertAdmin(db: Knex, admin: NewAdmin): Promise<string> {
  const [row] = await db('admin_users')
    .insert({
      username: admin.username,
      email: `${admin.username}@bridgepath.test`,
      password_hash: passwordHash(admin.password ?? PASSWORD),
      role: admin.role ?? 'manager',
      is_active: admin.active ?? true,
      must_change_password: admin.mustChangePassword ?? false
    })
    .returning('id');
  return row.id as string;
}

let receiptCounter = 0;

export interface NewEstimate {
  receipt_id?: string;
  category?: string;
  status?: string;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  company_name?: string | null;
  customer_type?: string | null;
  privacy_consent_at?: Date | string | null;
  privacy_consent_version?: string | null;
  created_at?: Date | string;
  request_kind?: string;
  customer_id?: string | null;
}

// Inserts an estimate directly (no API). Receipt ids are unique per call.
export async function insertEstimate(db: Knex, estimate: NewEstimate = {}): Promise<{ id: string; receipt_id: string }> {
  receiptCounter += 1;
  const receipt_id = estimate.receipt_id ?? `BP20260101${String(receiptCounter).padStart(3, '0')}`;
  const [row] = await db('estimates')
    .insert({
      receipt_id,
      category: estimate.category ?? 'shoes',
      status: estimate.status ?? 'new_receipt',
      customer_name: estimate.customer_name === undefined ? 'Kim' : estimate.customer_name,
      customer_email: estimate.customer_email === undefined ? 'kim@example.com' : estimate.customer_email,
      customer_phone: estimate.customer_phone ?? null,
      company_name: estimate.company_name ?? null,
      ...(estimate.customer_type !== undefined ? { customer_type: estimate.customer_type } : {}),
      ...(estimate.privacy_consent_at !== undefined ? { privacy_consent_at: estimate.privacy_consent_at } : {}),
      ...(estimate.privacy_consent_version !== undefined
        ? { privacy_consent_version: estimate.privacy_consent_version }
        : {}),
      ...(estimate.request_kind !== undefined ? { request_kind: estimate.request_kind } : {}),
      ...(estimate.customer_id !== undefined ? { customer_id: estimate.customer_id } : {}),
      specification_json: JSON.stringify(SHOE_SPEC),
      ...(estimate.created_at ? { created_at: estimate.created_at } : {})
    })
    .returning(['id', 'receipt_id']);
  return { id: row.id as string, receipt_id: row.receipt_id as string };
}

export interface Session {
  cookie: string;
  accessToken: string;
  refreshToken: string;
}

function cookieValue(cookies: string[], name: string): string {
  const found = cookies.find(c => c.startsWith(`${name}=`));
  if (!found) {
    throw new Error(`Response did not set the ${name} cookie`);
  }
  return found.split(';')[0].slice(name.length + 1);
}

// Logs in over HTTP and returns the cookies, ready for .set('Cookie', session.cookie).
export async function login(app: Express, username: string, password: string): Promise<Session> {
  const res = await request(app).post('/admin/login').send({ username, password });
  if (res.status !== 200) {
    throw new Error(`Login failed with status ${res.status}`);
  }
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const accessToken = cookieValue(cookies, 'access_token');
  const refreshToken = cookieValue(cookies, 'refresh_token');
  return { cookie: `access_token=${accessToken}`, accessToken, refreshToken };
}

export function cookieValueOf(res: request.Response, name: string): string | undefined {
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const found = cookies.find(c => c.startsWith(`${name}=`));
  return found ? found.split(';')[0].slice(name.length + 1) : undefined;
}

// Waits for all promises and separates the successes from the failures.
export async function settle<T>(promises: Array<Promise<T>>): Promise<{ ok: T[]; failed: unknown[] }> {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : [])),
    failed: results.flatMap(r => (r.status === 'rejected' ? [r.reason] : []))
  };
}
