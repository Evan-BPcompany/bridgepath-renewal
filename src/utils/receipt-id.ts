import { getPool } from '../config/database';
import type { PoolClient } from 'pg';
import logger from './logger';
import { runInTransaction } from './transactionRetry';

const RECEIPT_PREFIX = 'BP';
const SEQUENCE_PAD_WIDTH = 3;
const MAX_SEQUENCE = 999;

// The date in a receipt id is the calendar date in Korea (Asia/Seoul, UTC+9, no daylight
// saving). It does not depend on the server's time zone: a Heroku dyno runs in UTC, where
// 00:00-08:59 Korean time still belongs to the previous day.
export const RECEIPT_TIME_ZONE = 'Asia/Seoul';

const seoulDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: RECEIPT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

function seoulDateParts(date: Date): { year: string; month: string; day: string } {
  const parts: Record<string, string> = {};
  for (const part of seoulDateFormat.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function formatDate(date: Date): string {
  const { year, month, day } = seoulDateParts(date);
  return `${year}${month}${day}`;
}

export function formatSequence(sequence: number): string {
  return String(sequence).padStart(SEQUENCE_PAD_WIDTH, '0');
}

// Takes the next number of the day with one atomic upsert. Concurrent callers queue on the
// row lock of receipt_sequence (also for the first number of a day, where ON CONFLICT turns
// the lost insert race into an update), so under READ COMMITTED nobody fails and nobody gets
// the same number. The row stays locked until the surrounding transaction ends; if that
// transaction rolls back, the number is given back and no gap appears.
export async function generateReceiptIdInTransaction(client: PoolClient): Promise<string> {
  const dateStr = formatDate(new Date());

  const result = await client.query(
    `INSERT INTO receipt_sequence (receipt_date, last_sequence, created_at, updated_at)
     VALUES ($1::date, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (receipt_date)
     DO UPDATE SET last_sequence = receipt_sequence.last_sequence + 1,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING last_sequence`,
    [dateStr]
  );

  const nextSequence = Number(result.rows[0].last_sequence);

  // Throwing rolls the whole transaction back, which also undoes the increment.
  if (nextSequence > MAX_SEQUENCE) {
    throw new Error(`Receipt sequence overflow for date: exceeded ${MAX_SEQUENCE}`);
  }

  const receiptId = `${RECEIPT_PREFIX}${dateStr}${formatSequence(nextSequence)}`;

  logger.info('Generated receipt ID in transaction', {
    receiptId,
    date: dateStr,
    sequence: nextSequence
  });

  return receiptId;
}

// Stand-alone variant with its own transaction (one try plus 3 retries on 40001 or a
// receipt-number collision). Kept for compatibility; estimates take their number inside the
// estimate transaction with generateReceiptIdInTransaction.
export async function generateReceiptId(): Promise<string> {
  return runInTransaction(getPool(), client => generateReceiptIdInTransaction(client), {
    label: 'generateReceiptId'
  });
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

  const currentYear = Number(seoulDateParts(new Date()).year);
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
