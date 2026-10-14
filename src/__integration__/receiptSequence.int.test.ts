jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { describeIntegration } from './helpers/integrationMode';
import { useIsolatedSchema } from './helpers/lifecycle';
import { resetData, settle } from './helpers/fixtures';
import logger from '../utils/logger';
import {
  generateReceiptId,
  generateReceiptIdInTransaction,
  parseReceiptId,
  validateReceiptId
} from '../utils/receipt-id';
import { getPool } from '../config/database';

// Only Date is faked; the timers pg and the retry back-off rely on keep running.
const FAKE_ONLY_DATE: Array<
  | 'hrtime' | 'nextTick' | 'performance' | 'queueMicrotask' | 'requestAnimationFrame'
  | 'cancelAnimationFrame' | 'requestIdleCallback' | 'cancelIdleCallback' | 'setImmediate'
  | 'clearImmediate' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'
> = [
  'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'
];

const setClock = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: FAKE_ONLY_DATE });

describeIntegration('receipt ids on a real PostgreSQL', ({ url }) => {
  const suite = useIsolatedSchema(url);

  const sequenceRows = async () =>
    suite().db('receipt_sequence').select('last_sequence').orderBy('receipt_date');

  beforeEach(async () => {
    await resetData(suite().db);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Runs a transaction like estimateService does (READ COMMITTED) and returns the id, or throws.
  const idInTransaction = async (): Promise<string> => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const id = await generateReceiptIdInTransaction(client);
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  describe('one at a time', () => {
    it('numbers receipts 001, 002, 003 within a day', async () => {
      setClock('2026-10-13T03:00:00Z');

      const ids = [await generateReceiptId(), await generateReceiptId(), await generateReceiptId()];

      expect(ids).toEqual(['BP20261013001', 'BP20261013002', 'BP20261013003']);
      expect(await sequenceRows()).toEqual([{ last_sequence: 3 }]);
      for (const id of ids) {
        expect(validateReceiptId(id)).toBe(true);
      }
    });

    it('starts again at 001 on the next Korean day and keeps the old day', async () => {
      setClock('2026-10-12T14:59:00Z'); // 23:59 on 12 Oct in Korea
      expect(await generateReceiptId()).toBe('BP20261012001');
      expect(await generateReceiptId()).toBe('BP20261012002');

      jest.setSystemTime(new Date('2026-10-12T15:00:30Z')); // 00:00:30 on 13 Oct in Korea
      expect(await generateReceiptId()).toBe('BP20261013001');

      const rows = await suite().db('receipt_sequence').select('last_sequence').select(suite().db.raw("to_char(receipt_date, 'YYYYMMDD') AS day")).orderBy('receipt_date');
      expect(rows.map((r: { day: string; last_sequence: number }) => [r.day, r.last_sequence])).toEqual([
        ['20261012', 2],
        ['20261013', 1]
      ]);
    });

    it('the transaction variant continues the same sequence', async () => {
      setClock('2026-10-13T03:00:00Z');

      expect(await generateReceiptId()).toBe('BP20261013001');
      expect(await idInTransaction()).toBe('BP20261013002');
      expect(await generateReceiptId()).toBe('BP20261013003');
    });

    it('a rolled-back transaction gives its number back (no gap)', async () => {
      setClock('2026-10-13T03:00:00Z');

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        expect(await generateReceiptIdInTransaction(client)).toBe('BP20261013001');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      expect(await generateReceiptId()).toBe('BP20261013001');
    });

    it('stops after 999 receipts in a day and changes nothing', async () => {
      setClock('2026-10-13T03:00:00Z');
      await suite().db('receipt_sequence').insert({ receipt_date: '2026-10-13', last_sequence: 999 });

      await expect(generateReceiptId()).rejects.toThrow(/overflow/i);
      await expect(idInTransaction()).rejects.toThrow(/overflow/i);

      expect(await sequenceRows()).toEqual([{ last_sequence: 999 }]);
    });
  });

  describe('at the same time', () => {
    // Every request must get a number: no failure is tolerated, no duplicate, no gap.
    const expectAllNumbered = async (ok: string[], failed: unknown[], expected: number) => {
      expect(failed).toEqual([]);
      expect(ok).toHaveLength(expected);
      expect(new Set(ok).size).toBe(expected);
      const sequences = ok.map(id => parseReceiptId(id)!.sequence).sort((x, y) => x - y);
      expect(sequences).toEqual(Array.from({ length: expected }, (_, i) => i + 1));
      expect(await sequenceRows()).toEqual([{ last_sequence: expected }]);
    };

    it('5 parallel requests all succeed with unique, gap-free numbers', async () => {
      setClock('2026-10-13T03:00:00Z');

      const { ok, failed } = await settle(Array.from({ length: 5 }, () => generateReceiptId()));

      await expectAllNumbered(ok, failed, 5);
      expect([...ok].sort()).toEqual(
        Array.from({ length: 5 }, (_, i) => `BP20261013${String(i + 1).padStart(3, '0')}`)
      );
    });

    it('30 parallel requests all succeed: the first number of a day does not race either', async () => {
      setClock('2026-10-13T03:00:00Z');

      const { ok, failed } = await settle(Array.from({ length: 30 }, () => generateReceiptId()));

      await expectAllNumbered(ok, failed, 30);
    });

    it('parallel estimate-style transactions all succeed, without any retry', async () => {
      setClock('2026-10-13T03:00:00Z');

      const { ok, failed } = await settle(Array.from({ length: 20 }, () => idInTransaction()));

      await expectAllNumbered(ok, failed, 20);
      // No request was retried: nothing was logged as contention.
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('a rollback in the middle of a burst gives its number back: no gap among the committed ones', async () => {
      setClock('2026-10-13T03:00:00Z');

      const attempt = async (index: number): Promise<string> => {
        const client = await getPool().connect();
        try {
          await client.query('BEGIN');
          const id = await generateReceiptIdInTransaction(client);
          if (index % 3 === 0) {
            throw new Error('estimate insert failed');
          }
          await client.query('COMMIT');
          return id;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      };

      const { ok, failed } = await settle(Array.from({ length: 12 }, (_, i) => attempt(i)));

      expect(failed).toHaveLength(4);
      expect(ok).toHaveLength(8);
      const sequences = ok.map(id => parseReceiptId(id)!.sequence).sort((x, y) => x - y);
      expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await sequenceRows()).toEqual([{ last_sequence: 8 }]);
    });
  });
});
