import { getPool } from '../config/database';
import logger from '../utils/logger';

// What is kept, and for how long, of the data that only exists for a moment. Customers, estimates,
// quotes and inquiries are NOT touched here: how long those are kept is a decision of the company
// (the privacy text), not a housekeeping job.
export const RETENTION_DAYS = Object.freeze({
  // Sessions, e-mail codes and access links are useless once they have expired or been revoked; a few
  // days are kept so that a support question ("I was signed out") can still be looked into.
  expiredCredentials: 7,
  // Sent e-mails hold the text of a notice (a name, a receipt number): not kept for longer than needed.
  sentEmails: 90,
  // Failed ones stay longer, to find out why they failed.
  failedEmails: 180
});

export interface CleanupResult {
  customer_sessions: number;
  customer_email_codes: number;
  admin_sessions: number;
  estimate_access_tokens: number;
  email_events_sent: number;
  email_events_failed: number;
}

interface Statement {
  key: keyof CleanupResult;
  sql: string;
  days: number;
}

// Each statement removes finished things only: nothing that is still valid, and no e-mail that is
// waiting to be sent or being sent.
const STATEMENTS: readonly Statement[] = [
  {
    key: 'customer_sessions',
    days: RETENTION_DAYS.expiredCredentials,
    sql: `DELETE FROM customer_sessions
          WHERE expires_at < now() - make_interval(days => $1)
             OR (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => $1))`
  },
  {
    key: 'customer_email_codes',
    days: RETENTION_DAYS.expiredCredentials,
    sql: `DELETE FROM customer_email_codes WHERE expires_at < now() - make_interval(days => $1)`
  },
  {
    key: 'admin_sessions',
    days: RETENTION_DAYS.expiredCredentials,
    sql: `DELETE FROM admin_sessions
          WHERE expires_at < now() - make_interval(days => $1)
             OR (is_revoked = true AND last_activity_at < now() - make_interval(days => $1))`
  },
  {
    key: 'estimate_access_tokens',
    days: RETENTION_DAYS.expiredCredentials,
    sql: `DELETE FROM estimate_access_tokens WHERE expires_at < now() - make_interval(days => $1)`
  },
  {
    key: 'email_events_sent',
    days: RETENTION_DAYS.sentEmails,
    sql: `DELETE FROM email_events WHERE status = 'sent' AND COALESCE(sent_at, created_at) < now() - make_interval(days => $1)`
  },
  {
    key: 'email_events_failed',
    days: RETENTION_DAYS.failedEmails,
    sql: `DELETE FROM email_events WHERE status = 'failed' AND created_at < now() - make_interval(days => $1)`
  }
];

export async function cleanupExpiredData(): Promise<CleanupResult> {
  const pool = getPool();
  const result = {} as CleanupResult;

  for (const statement of STATEMENTS) {
    const outcome = await pool.query(statement.sql, [statement.days]);
    result[statement.key] = outcome.rowCount ?? 0;
  }
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

async function runOnce(): Promise<void> {
  try {
    const result = await cleanupExpiredData();
    logger.info('Cleanup of expired data', { ...result });
  } catch (err) {
    logger.error('Cleanup of expired data failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

// Once a day, a minute after the start, so that a restart does not wait a day for the first run.
// One server process only, like the e-mail worker; a second process would only delete the same rows.
export function startCleanupSchedule(): void {
  if (timer !== null) {
    return;
  }
  const first = setTimeout(() => {
    void runOnce();
    timer = setInterval(() => void runOnce(), DAY_MS);
    timer.unref();
  }, 60 * 1000);
  first.unref();
  timer = first;
}

export function stopCleanupSchedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}
