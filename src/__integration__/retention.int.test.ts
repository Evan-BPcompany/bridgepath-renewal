jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { cleanupExpiredData, RETENTION_DAYS } from '../services/retentionService';
import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { insertAdmin, insertEstimate, resetData } from './helpers/fixtures';

// The daily cleanup on a real PostgreSQL: it removes what is finished and long expired, and nothing
// that is still valid, still waiting to be sent, or belongs to the customers' data.
describeIntegration('the cleanup of expired data on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);
  const ago = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const count = async (table: string): Promise<number> => Number((await suite().db(table).count({ n: '*' }).first())?.n);

  let customerId: string;
  let adminId: string;
  let estimate: { id: string; receipt_id: string };
  let n = 0;

  beforeEach(async () => {
    await resetData(suite().db);
    n = 0;
    [{ id: customerId }] = await suite().db('customers').insert({ email: 'buyer@example.com' }).returning('id');
    adminId = await insertAdmin(suite().db, { username: 'cleaner' });
    estimate = await insertEstimate(suite().db);
  });

  const customerSession = (over: Record<string, unknown>) =>
    suite().db('customer_sessions').insert({ customer_id: customerId, token_hash: `hash-${(n += 1)}`, expires_at: ago(-30), ...over });
  const adminSession = (over: Record<string, unknown>) =>
    suite().db('admin_sessions').insert({ admin_user_id: adminId, refresh_token_hash: `refresh-${(n += 1)}`, expires_at: ago(-30), ...over });
  const email = (status: string, over: Record<string, unknown>) =>
    suite().db('email_events').insert({
      recipient_email: 'a@example.com', email_type: 'receipt', subject: 's', body: 'b', status, idempotency_key: `key-${(n += 1)}`, ...over
    });

  it('removes customer sessions long expired or long revoked, and keeps the valid and the recent', async () => {
    await customerSession({ expires_at: ago(RETENTION_DAYS.expiredCredentials + 1) }); // long expired
    await customerSession({ revoked_at: ago(RETENTION_DAYS.expiredCredentials + 1) }); // long revoked
    await customerSession({ expires_at: ago(1) }); // expired yesterday: kept for support
    await customerSession({ revoked_at: ago(1) });
    await customerSession({}); // valid

    const result = await cleanupExpiredData();

    expect(result.customer_sessions).toBe(2);
    expect(await count('customer_sessions')).toBe(3);
  });

  it('removes old e-mail codes and access links, and keeps the recent', async () => {
    await suite().db('customer_email_codes').insert({ customer_id: customerId, purpose: 'signup', code_hash: 'x', expires_at: ago(RETENTION_DAYS.expiredCredentials + 1) });
    await suite().db('estimate_access_tokens').insert([
      { estimate_id: estimate.id, receipt_id: estimate.receipt_id, token: 't-old', expires_at: ago(RETENTION_DAYS.expiredCredentials + 1) },
      { estimate_id: estimate.id, receipt_id: estimate.receipt_id, token: 't-valid', expires_at: ago(-3) }
    ]);

    const result = await cleanupExpiredData();

    expect(result.customer_email_codes).toBe(1);
    expect(result.estimate_access_tokens).toBe(1);
    expect(await count('customer_email_codes')).toBe(0);
    expect((await suite().db('estimate_access_tokens').select('token')).map(row => row.token)).toEqual(['t-valid']);
  });

  it('removes admin sessions long expired or revoked and idle, and keeps a revoked one that was used recently', async () => {
    await adminSession({ expires_at: ago(RETENTION_DAYS.expiredCredentials + 1) });
    await adminSession({ is_revoked: true, last_activity_at: ago(RETENTION_DAYS.expiredCredentials + 1) });
    await adminSession({ is_revoked: true, last_activity_at: ago(1) });
    await adminSession({});

    const result = await cleanupExpiredData();

    expect(result.admin_sessions).toBe(2);
    expect(await count('admin_sessions')).toBe(2);
  });

  it('removes old sent and old failed e-mails, never a pending or sending one, however old', async () => {
    await email('sent', { sent_at: ago(RETENTION_DAYS.sentEmails + 1), created_at: ago(RETENTION_DAYS.sentEmails + 2) });
    await email('sent', { sent_at: ago(5) });
    await email('failed', { created_at: ago(RETENTION_DAYS.failedEmails + 1) });
    await email('failed', { created_at: ago(RETENTION_DAYS.sentEmails + 1) }); // failed ones are kept longer
    await email('pending', { created_at: ago(400) });
    await email('sending', { created_at: ago(400) });

    const result = await cleanupExpiredData();

    expect(result.email_events_sent).toBe(1);
    expect(result.email_events_failed).toBe(1);
    expect((await suite().db('email_events').select('status').orderBy('status')).map(row => row.status)).toEqual(['failed', 'pending', 'sending', 'sent']);
  });

  it('leaves customers, their identities and the estimates alone, and a second run removes nothing more', async () => {
    await customerSession({ expires_at: ago(100) });

    await cleanupExpiredData();
    const second = await cleanupExpiredData();

    expect(Object.values(second).every(value => value === 0)).toBe(true);
    expect(await count('customers')).toBe(1);
    expect(await count('estimates')).toBe(1);
  });
});
