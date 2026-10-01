import { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { config } from '../config/env';
import logger from '../utils/logger';

export interface EmailEventData {
  recipient_email: string;
  email_type: 'receipt' | 'admin_notification' | 'quotation' | 'status_update';
  estimate_id: string;
  idempotency_key: string;
  subject: string;
  body: string;
}

export interface EmailEvent {
  id: string;
  recipient_email: string;
  email_type: string;
  estimate_id: string;
  subject: string;
  body: string;
  status: string;
  idempotency_key: string;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

/**
 * Queue email for sending (outbox pattern)
 * Should be called within the same transaction as estimate creation
 * to ensure consistency.
 */
export async function queueEmailInTransaction(
  client: PoolClient,
  data: EmailEventData
): Promise<void> {
  const query = `
    INSERT INTO email_events (
      recipient_email, email_type, estimate_id, subject, body,
      status, idempotency_key, retry_count, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (idempotency_key) DO NOTHING
  `;

  await client.query(query, [
    data.recipient_email,
    data.email_type,
    data.estimate_id,
    data.subject,
    data.body,
    data.idempotency_key
  ]);
}

/**
 * Claim pending email events for processing (Stage A: Short DB transaction)
 * Uses FOR UPDATE SKIP LOCKED to ensure no duplicate processing
 */
export async function claimPendingEmailEvents(limit: number = 10): Promise<EmailEvent[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const query = `
      SELECT id, recipient_email, email_type, estimate_id, subject, body,
             status, idempotency_key, retry_count, next_retry_at, last_error,
             provider_message_id, created_at, updated_at, sent_at
      FROM email_events
      WHERE status IN ('pending', 'sending')
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `;

    const result = await client.query(query, [limit]);
    const events = result.rows as EmailEvent[];

    // Mark all claimed events as 'sending' and update updated_at
    if (events.length > 0) {
      const ids = events.map(e => e.id);
      const updateQuery = `
        UPDATE email_events
        SET status = 'sending', updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
      `;
      await client.query(updateQuery, [ids]);
    }

    await client.query('COMMIT');
    return events;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback error
    }
    logger.error('Failed to claim pending email events', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark email as successfully sent (Stage B: After SendGrid call)
 */
export async function markEmailSent(
  eventId: string,
  providerMessageId: string
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const query = `
      UPDATE email_events
      SET status = 'sent',
          sent_at = CURRENT_TIMESTAMP,
          provider_message_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    await client.query(query, [eventId, providerMessageId]);
  } catch (err) {
    logger.error('Failed to mark email as sent', {
      event_id: eventId,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Schedule email for retry or mark as failed (Stage B: After SendGrid failure)
 * retry_count semantics:
 * - 0: initial (before first attempt)
 * - 1: first attempt failed, schedule 1min retry
 * - 2: second attempt failed, schedule 2min retry
 * - 3: third attempt failed, schedule 4min retry
 * - after 3rd failure: status='failed'
 */
export async function scheduleEmailRetry(
  eventId: string,
  lastError: string
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // First, get current retry_count
    const getQuery = `
      SELECT retry_count FROM email_events WHERE id = $1
    `;
    const result = await client.query(getQuery, [eventId]);

    if (result.rows.length === 0) {
      logger.warn('Email event not found for retry', { event_id: eventId });
      return;
    }

    const currentRetryCount = result.rows[0].retry_count;
    const newRetryCount = currentRetryCount + 1;

    // If already at max retries (3), mark as failed
    if (newRetryCount > 3) {
      const failQuery = `
        UPDATE email_events
        SET status = 'failed',
            last_error = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
      await client.query(failQuery, [eventId, lastError]);
      logger.info('Email marked as failed after max retries', {
        event_id: eventId,
        retry_count: currentRetryCount
      });
      return;
    }

    // Calculate next retry time based on retry count
    let delayMinutes = 0;
    if (newRetryCount === 1) {
      delayMinutes = 1; // 1 minute
    } else if (newRetryCount === 2) {
      delayMinutes = 2; // 2 minutes
    } else if (newRetryCount === 3) {
      delayMinutes = 4; // 4 minutes
    }

    const retryQuery = `
      UPDATE email_events
      SET status = 'pending',
          retry_count = $2,
          next_retry_at = CURRENT_TIMESTAMP + INTERVAL '${delayMinutes} minutes',
          last_error = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;

    await client.query(retryQuery, [eventId, newRetryCount, lastError]);

    logger.info('Email scheduled for retry', {
      event_id: eventId,
      retry_count: newRetryCount,
      delay_minutes: delayMinutes
    });
  } catch (err) {
    logger.error('Failed to schedule email retry', {
      event_id: eventId,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recover stale sending events that appear to be stuck
 * If retry_count < 3, move back to pending
 * If retry_count = 3, mark as failed
 */
export async function recoverStaleEmailEvents(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Find events stuck in sending state for too long
    const staleTimeoutMs = config.emailWorker.staleTimeoutMs;
    const staleTimeoutSec = Math.floor(staleTimeoutMs / 1000);

    const recoverQuery = `
      UPDATE email_events
      SET status = CASE
            WHEN retry_count < 3 THEN 'pending'
            WHEN retry_count = 3 THEN 'failed'
            ELSE 'failed'
          END,
          next_retry_at = CASE
            WHEN retry_count < 3 THEN CURRENT_TIMESTAMP + INTERVAL '1 minute'
            ELSE null
          END,
          updated_at = CURRENT_TIMESTAMP,
          last_error = 'Recovered from stale sending state'
      WHERE status = 'sending'
        AND updated_at < CURRENT_TIMESTAMP - INTERVAL '${staleTimeoutSec} seconds'
    `;

    const result = await client.query(recoverQuery);

    if (result.rowCount && result.rowCount > 0) {
      logger.info('Recovered stale email events', { count: result.rowCount });
    }
  } catch (err) {
    logger.error('Failed to recover stale email events', {
      error: err instanceof Error ? err.message : String(err)
    });
    // Don't throw - this is a background operation
  } finally {
    client.release();
  }
}

/**
 * Get email event by ID (for testing)
 */
export async function getEmailEvent(eventId: string): Promise<EmailEvent | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const query = `
      SELECT id, recipient_email, email_type, estimate_id, subject, body,
             status, idempotency_key, retry_count, next_retry_at, last_error,
             provider_message_id, created_at, updated_at, sent_at
      FROM email_events
      WHERE id = $1
    `;

    const result = await client.query(query, [eventId]);
    return result.rows.length > 0 ? (result.rows[0] as EmailEvent) : null;
  } catch (err) {
    logger.error('Failed to get email event', {
      event_id: eventId,
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete all email events for testing
 */
export async function deleteAllEmailEvents(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM email_events');
  } catch (err) {
    logger.error('Failed to delete email events', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  } finally {
    client.release();
  }
}
