import type { Pool, PoolClient } from 'pg';
import logger from './logger';

// One try plus RETRY_COUNT retries: at most MAX_ATTEMPTS (4) attempts in total.
export const RETRY_COUNT = 3;
export const MAX_ATTEMPTS = RETRY_COUNT + 1;
export const INITIAL_RETRY_DELAY_MS = 10;

export const SERIALIZATION_FAILURE = '40001';
export const UNIQUE_VIOLATION = '23505';

function sqlState(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export class TransactionRetryExhaustedError extends Error {
  readonly code: string | undefined;
  readonly attempts: number;
  readonly cause: unknown;

  constructor(attempts: number, cause: unknown) {
    const code = sqlState(cause);
    super(`Transaction failed after ${attempts} attempts${code ? ` (SQLSTATE ${code})` : ''}`);
    this.name = 'TransactionRetryExhaustedError';
    this.code = code;
    this.attempts = attempts;
    this.cause = cause;
  }
}

// The unique constraint on receipt_sequence.receipt_date (migration 006: `receipt_date DATE NOT NULL
// UNIQUE`, which PostgreSQL names <table>_<column>_key). Two writers inserting the first number
// of a day at the same moment collide on it. The integration suite checks this name against a
// real database (migrations.int.test.ts).
export const RECEIPT_SEQUENCE_DATE_CONSTRAINT = 'receipt_sequence_receipt_date_key';

// 40001 is always safe to run again: PostgreSQL rolled the transaction back. 23505 is retried
// only for exactly that constraint; every other unique violation (estimates.receipt_id, e-mail
// idempotency keys, admin usernames, ...) would fail again or hide a real problem, so it fails
// at once. Decided by SQLSTATE and constraint name, never by the message text.
export function isRetryableError(err: unknown): boolean {
  const code = sqlState(err);
  if (code === SERIALIZATION_FAILURE) {
    return true;
  }
  if (code === UNIQUE_VIOLATION) {
    return (err as { constraint?: unknown }).constraint === RECEIPT_SEQUENCE_DATE_CONSTRAINT;
  }
  return false;
}

export interface TransactionOptions {
  // Lets tests skip the real back-off delay.
  sleep?: (ms: number) => Promise<void>;
  label?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Runs `work` in one transaction (PostgreSQL's default READ COMMITTED level) and runs the
// whole transaction again, on a fresh connection, when it fails with a retryable error.
//
// An error from COMMIT itself is never retried: the outcome is then unknown (the commit may
// have gone through), so running the work again could create everything twice. The one
// exception is 40001, which PostgreSQL only reports for a transaction it has rolled back.
export async function runInTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let committing = false;
    let delayMs: number;

    try {
      await client.query('BEGIN');
      const result = await work(client);
      committing = true;
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The transaction may already be rolled back or the connection gone; the original
        // error is what matters.
      }

      const retryable = isRetryableError(err) && (!committing || sqlState(err) === SERIALIZATION_FAILURE);

      if (!retryable) {
        throw err;
      }
      if (attempt >= MAX_ATTEMPTS) {
        logger.error('Transaction failed after retries', {
          label: options.label,
          attempts: attempt,
          errorCode: sqlState(err)
        });
        throw new TransactionRetryExhaustedError(attempt, err);
      }

      delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('Transaction conflict, retrying', {
        label: options.label,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        errorCode: sqlState(err),
        delayMs
      });
    } finally {
      client.release();
    }

    // Back off after the connection went back to the pool, so waiting holds nothing.
    await sleep(delayMs);
  }
}
