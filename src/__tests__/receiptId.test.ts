jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import logger from '../utils/logger';
import {
  formatDate,
  formatSequence,
  generateReceiptId,
  generateReceiptIdInTransaction,
  parseReceiptId,
  validateReceiptId
} from '../utils/receipt-id';
import { createFakeDb } from './helpers/adminTestUtils';

// Receipt ids: BP + YYYYMMDD + a 3 digit sequence per day. The SQL runs against a fake pool.

const NOW = new Date(2026, 9, 13, 12, 0, 0); // 13 Oct 2026, local time
const TODAY = '20261013';

describe('receipt id generation (fake database)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let lastSequence: number | null;

  const statements = () => db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    db = createFakeDb();
    lastSequence = null;
    (getPool as jest.Mock).mockReturnValue(db.pool);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);

    db.state.handler = (sql, params) => {
      const text = sql.replace(/\s+/g, ' ');
      if (text.includes('SELECT last_sequence FROM receipt_sequence')) {
        return { rows: lastSequence === null ? [] : [{ last_sequence: lastSequence }] };
      }
      if (text.includes('UPDATE receipt_sequence')) {
        lastSequence = params[0] as number;
        return { rows: [] };
      }
      if (text.includes('INSERT INTO receipt_sequence')) {
        lastSequence = params[1] as number;
        return { rows: [] };
      }
      return undefined;
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('helpers', () => {
    it('formats the date as YYYYMMDD and the sequence with three digits', () => {
      expect(formatDate(new Date(2026, 0, 5))).toBe('20260105');
      expect(formatDate(NOW)).toBe(TODAY);
      expect(formatSequence(1)).toBe('001');
      expect(formatSequence(42)).toBe('042');
      expect(formatSequence(999)).toBe('999');
    });

    it('parses valid ids into their parts and rejects everything else', () => {
      expect(parseReceiptId('BP20261013007')).toEqual({
        prefix: 'BP',
        date: '20261013',
        year: 2026,
        month: 10,
        day: 13,
        sequence: 7
      });

      for (const bad of ['', 'BP2026101307', 'BP202610130077', 'XX20261013007', 'bp20261013007', 'BP-20261013-007', 'BP20261013 07']) {
        expect(parseReceiptId(bad)).toBeNull();
      }
    });

    it('validates the date part: year 2020 up to next year, month 1-12, day 1-31', () => {
      const year = new Date().getFullYear();

      expect(validateReceiptId(`BP${year}0101001`)).toBe(true);
      expect(validateReceiptId(`BP${year + 1}1231999`)).toBe(true);
      expect(validateReceiptId('BP20191231001')).toBe(false);
      expect(validateReceiptId(`BP${year + 2}0101001`)).toBe(false);
      expect(validateReceiptId(`BP${year}1301001`)).toBe(false);
      expect(validateReceiptId(`BP${year}0001001`)).toBe(false);
      expect(validateReceiptId(`BP${year}0132001`)).toBe(false);
      expect(validateReceiptId(`BP${year}0100001`)).toBe(false);
    });
  });

  describe('generateReceiptId (own transaction)', () => {
    it('starts at 001 for the first request of the day', async () => {
      expect(await generateReceiptId()).toBe(`BP${TODAY}001`);

      const insert = db.state.queries.find(q => q.sql.includes('INSERT INTO receipt_sequence'))!;
      expect(insert.params).toEqual([TODAY, 1]);
    });

    it('continues the sequence of the day', async () => {
      lastSequence = 41;

      expect(await generateReceiptId()).toBe(`BP${TODAY}042`);

      const update = db.state.queries.find(q => q.sql.includes('UPDATE receipt_sequence'))!;
      expect(update.params).toEqual([42, TODAY]);
    });

    it('hands out consecutive, unique ids', async () => {
      const ids = [await generateReceiptId(), await generateReceiptId(), await generateReceiptId()];

      expect(ids).toEqual([`BP${TODAY}001`, `BP${TODAY}002`, `BP${TODAY}003`]);
    });

    it('runs in a SERIALIZABLE transaction and locks the sequence row', async () => {
      await generateReceiptId();

      const order = statements();
      expect(order[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
      expect(order[1]).toContain('FOR UPDATE');
      expect(order[order.length - 1]).toBe('COMMIT');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('refuses the 1000th id of a day and rolls back, so the counter does not move', async () => {
      lastSequence = 999;
      const sequenceBefore = lastSequence;
      db.state.handler = sql => {
        if (sql.includes('SELECT last_sequence')) {
          return { rows: [{ last_sequence: 999 }] };
        }
        return undefined;
      };

      await expect(generateReceiptId()).rejects.toThrow('Receipt sequence overflow for date: exceeded 999');

      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
      expect(lastSequence).toBe(sequenceBefore);
    });

    describe('contention retries', () => {
      const contention = (code: string, times: number) => {
        let remaining = times;
        const original = db.state.handler;
        db.state.handler = (sql, params) => {
          if (sql.includes('SELECT last_sequence') && remaining > 0) {
            remaining -= 1;
            throw Object.assign(new Error('could not serialize access'), { code });
          }
          return original(sql, params);
        };
      };

      it.each([['40001'], ['23505']])('retries after error code %s and then succeeds', async code => {
        contention(code, 2);

        const pending = generateReceiptId();
        await jest.advanceTimersByTimeAsync(10 + 20);

        expect(await pending).toBe(`BP${TODAY}001`);
        expect(db.pool.connect).toHaveBeenCalledTimes(3);
        expect(db.client.release).toHaveBeenCalledTimes(3);
        expect(statements().filter(s => s === 'ROLLBACK')).toHaveLength(2);
      });

      it('waits 10 ms, then 20 ms between attempts (exponential backoff)', async () => {
        contention('40001', 2);

        const pending = generateReceiptId();
        await jest.advanceTimersByTimeAsync(9);
        expect(db.pool.connect).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(db.pool.connect).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(19);
        expect(db.pool.connect).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(1);
        expect(db.pool.connect).toHaveBeenCalledTimes(3);

        await pending;
      });

      it('gives up after three attempts and reports the last error', async () => {
        contention('40001', 10);

        const pending = generateReceiptId();
        const assertion = expect(pending).rejects.toThrow('could not serialize access');
        await jest.advanceTimersByTimeAsync(100);
        await assertion;

        expect(db.pool.connect).toHaveBeenCalledTimes(3);
        expect(db.client.release).toHaveBeenCalledTimes(3);
      });

      it('does not retry errors that are not contention', async () => {
        const original = db.state.handler;
        db.state.handler = (sql, params) => {
          if (sql.includes('SELECT last_sequence')) {
            throw Object.assign(new Error('connection lost'), { code: '08006' });
          }
          return original(sql, params);
        };

        await expect(generateReceiptId()).rejects.toThrow('connection lost');

        expect(db.pool.connect).toHaveBeenCalledTimes(1);
        expect(statements()).toContain('ROLLBACK');
      });
    });
  });

  describe('generateReceiptIdInTransaction (caller\'s transaction)', () => {
    const client = () => db.client as unknown as PoolClient;

    it('returns the id and leaves BEGIN and COMMIT to the caller', async () => {
      expect(await generateReceiptIdInTransaction(client())).toBe(`BP${TODAY}001`);
      expect(await generateReceiptIdInTransaction(client())).toBe(`BP${TODAY}002`);

      expect(statements().some(s => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toBe(false);
      expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('locks the sequence row of the day', async () => {
      await generateReceiptIdInTransaction(client());

      expect(statements()[0]).toContain('FOR UPDATE');
    });

    it('refuses to go past 999 and lets the caller roll back', async () => {
      db.state.handler = sql => (sql.includes('SELECT last_sequence') ? { rows: [{ last_sequence: 999 }] } : undefined);

      await expect(generateReceiptIdInTransaction(client())).rejects.toThrow('Receipt sequence overflow');
    });
  });
});
