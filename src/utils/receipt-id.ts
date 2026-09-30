import { getPool } from '../config/database';
import type { PoolClient } from 'pg';
import logger from './logger';

const RECEIPT_PREFIX = 'BP';
const SEQUENCE_PAD_WIDTH = 3;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 10;

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function formatSequence(sequence: number): string {
  return String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateReceiptId(): Promise<string> {
  const pool = getPool();
  const today = new Date();
  const dateStr = formatDate(today);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const existingResult = await client.query(
        `SELECT last_sequence FROM receipt_sequence WHERE receipt_date = $1::date FOR UPDATE`,
        [dateStr]
      );

      let nextSequence = 1;

      if (existingResult.rows.length > 0) {
        nextSequence = existingResult.rows[0].last_sequence + 1;
        await client.query(
          `UPDATE receipt_sequence
           SET last_sequence = $1, updated_at = CURRENT_TIMESTAMP
           WHERE receipt_date = $2::date`,
          [nextSequence, dateStr]
        );
      } else {
        nextSequence = 1;
        await client.query(
          `INSERT INTO receipt_sequence (receipt_date, last_sequence, created_at, updated_at)
           VALUES ($1::date, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [dateStr, nextSequence]
        );
      }

      if (nextSequence > 999) {
        throw new Error('Receipt sequence overflow for date: exceeded 999');
      }

      await client.query('COMMIT');

      const sequenceStr = formatSequence(nextSequence);
      const receiptId = `${RECEIPT_PREFIX}${dateStr}${sequenceStr}`;

      if (attempt > 0) {
        logger.info('Generated receipt ID after retry', {
          receiptId,
          date: dateStr,
          sequence: nextSequence,
          attempts: attempt + 1
        });
      } else {
        logger.info('Generated receipt ID', {
          receiptId,
          date: dateStr,
          sequence: nextSequence
        });
      }

      return receiptId;
    } catch (err) {
      lastError = err as Error;

      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback error if transaction already rolled back
      }

      const isSerializationFailure =
        (err as any)?.code === '40001' || (err as any)?.code === 40001;
      const isUniqueViolation =
        (err as any)?.code === '23505' || (err as any)?.code === 23505;

      if ((isSerializationFailure || isUniqueViolation) && attempt < MAX_RETRIES - 1) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('Receipt sequence contention, retrying', {
          date: dateStr,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          errorCode: (err as any)?.code,
          delayMs
        });

        await sleep(delayMs);
        continue;
      }

      throw err;
    } finally {
      client.release();
    }
  }

  logger.error('Failed to generate receipt ID after retries', {
    date: dateStr,
    attempts: MAX_RETRIES,
    lastError: lastError?.message
  });

  throw new Error(
    `Failed to generate receipt ID after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
}

export function parseReceiptId(receiptId: string): {
  prefix: string;
  date: string;
  year: number;
  month: number;
  day: number;
  sequence: number;
} | null {
  const regex = /^BP(\d{4})(\d{2})(\d{2})(\d{3})$/;
  const match = receiptId.match(regex);

  if (!match) {
    return null;
  }

  const [, year, month, day, sequence] = match;

  return {
    prefix: 'BP',
    date: `${year}${month}${day}`,
    year: parseInt(year, 10),
    month: parseInt(month, 10),
    day: parseInt(day, 10),
    sequence: parseInt(sequence, 10)
  };
}

export function validateReceiptId(receiptId: string): boolean {
  const parsed = parseReceiptId(receiptId);
  if (!parsed) {
    return false;
  }

  const { year, month, day } = parsed;

  const currentYear = new Date().getFullYear();
  if (year < 2020 || year > currentYear + 1) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  if (day < 1 || day > 31) {
    return false;
  }

  return true;
}

export async function generateReceiptIdInTransaction(client: PoolClient): Promise<string> {
  const today = new Date();
  const dateStr = formatDate(today);

  const existingResult = await client.query(
    `SELECT last_sequence FROM receipt_sequence WHERE receipt_date = $1::date FOR UPDATE`,
    [dateStr]
  );

  let nextSequence = 1;

  if (existingResult.rows.length > 0) {
    nextSequence = existingResult.rows[0].last_sequence + 1;
    await client.query(
      `UPDATE receipt_sequence
       SET last_sequence = $1, updated_at = CURRENT_TIMESTAMP
       WHERE receipt_date = $2::date`,
      [nextSequence, dateStr]
    );
  } else {
    nextSequence = 1;
    await client.query(
      `INSERT INTO receipt_sequence (receipt_date, last_sequence, created_at, updated_at)
       VALUES ($1::date, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [dateStr, nextSequence]
    );
  }

  if (nextSequence > 999) {
    throw new Error('Receipt sequence overflow for date: exceeded 999');
  }

  const sequenceStr = formatSequence(nextSequence);
  const receiptId = `${RECEIPT_PREFIX}${dateStr}${sequenceStr}`;

  logger.info('Generated receipt ID in transaction', {
    receiptId,
    date: dateStr,
    sequence: nextSequence
  });

  return receiptId;
}
