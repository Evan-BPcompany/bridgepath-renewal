jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { config } from '../config/env';
import logger from '../utils/logger';
import {
  claimPendingEmailEvents,
  markEmailSent,
  queueEmailInTransaction,
  recoverStaleEmailEvents,
  scheduleEmailRetry
} from '../services/emailService';
import { createFakeDb } from './helpers/adminTestUtils';

// The email outbox, exercised against a fake pool: the SQL parameters, the order of the
// statements and the retry state machine are real; PostgreSQL itself is not involved.

describe('email outbox service (fake database)', () => {
  let db: ReturnType<typeof createFakeDb>;
  let errorSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const statements = () => db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());
  const find = (needle: string) => db.state.queries.find(q => q.sql.replace(/\s+/g, ' ').includes(needle));

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('queueEmailInTransaction', () => {
    const data = {
      recipient_email: 'buyer@example.com',
      email_type: 'receipt' as const,
      estimate_id: 'est-1',
      idempotency_key: 'receipt-est-1',
      subject: 'Receipt',
      body: '<p>Hi</p>'
    };

    it('inserts a pending event with the given values, using the caller\'s client', async () => {
      await queueEmailInTransaction(db.client as unknown as PoolClient, data);

      const insert = find('INSERT INTO email_events')!;
      expect(insert.params).toEqual(['buyer@example.com', 'receipt', 'est-1', 'Receipt', '<p>Hi</p>', 'receipt-est-1']);
      expect(insert.sql).toContain("'pending'");
      expect(insert.sql.replace(/\s+/g, ' ')).toContain('retry_count');
    });

    it('is idempotent: a repeated idempotency key is ignored by the database', async () => {
      await queueEmailInTransaction(db.client as unknown as PoolClient, data);

      expect(find('ON CONFLICT (idempotency_key) DO NOTHING')).toBeDefined();
    });

    it('takes part in the caller\'s transaction: no connection of its own, no BEGIN or COMMIT', async () => {
      await queueEmailInTransaction(db.client as unknown as PoolClient, data);

      expect(db.pool.connect).not.toHaveBeenCalled();
      expect(statements().some(s => /^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toBe(false);
    });

    it('lets a failing insert propagate so the caller can roll back', async () => {
      db.state.handler = () => {
        throw new Error('insert failed');
      };

      await expect(queueEmailInTransaction(db.client as unknown as PoolClient, data)).rejects.toThrow('insert failed');
    });
  });

  describe('claimPendingEmailEvents (stage A)', () => {
    const events = [
      { id: 'e1', recipient_email: 'a@example.com', retry_count: 0 },
      { id: 'e2', recipient_email: 'b@example.com', retry_count: 1 }
    ];

    it('locks rows with FOR UPDATE SKIP LOCKED, marks them sending and commits', async () => {
      db.state.handler = sql => (sql.includes('FOR UPDATE SKIP LOCKED') ? { rows: events } : undefined);

      const claimed = await claimPendingEmailEvents(5);

      expect(claimed).toEqual(events);
      const order = statements();
      expect(order[0]).toBe('BEGIN');
      expect(order[1]).toContain('FOR UPDATE SKIP LOCKED');
      expect(order[2]).toContain("SET status = 'sending'");
      expect(order[order.length - 1]).toBe('COMMIT');
      expect(find("SET status = 'sending'")!.params).toEqual([['e1', 'e2']]);
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('passes the limit (default 10) and orders oldest first', async () => {
      await claimPendingEmailEvents();
      await claimPendingEmailEvents(3);

      const selects = db.state.queries.filter(q => q.sql.includes('SKIP LOCKED'));
      expect(selects.map(q => q.params)).toEqual([[10], [3]]);
      expect(selects[0].sql).toContain('ORDER BY created_at ASC');
    });

    it('never claims an event that is already being sent (status sending), so it cannot be sent twice', async () => {
      await claimPendingEmailEvents();

      const select = find('FOR UPDATE SKIP LOCKED')!.sql.replace(/\s+/g, ' ');
      expect(select).toContain("WHERE status = 'pending'");
      expect(select).not.toContain("'sending'");
    });

    it('leaves events stuck in sending to the stale recovery, which moves them back to pending', async () => {
      await recoverStaleEmailEvents();

      const recovery = find("WHERE status = 'sending'")!.sql.replace(/\s+/g, ' ');
      expect(recovery).toContain("THEN 'pending'");
    });

    it('only picks events that are due', async () => {
      await claimPendingEmailEvents();

      expect(find('next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP')).toBeDefined();
    });

    it('writes nothing when no event is waiting', async () => {
      const claimed = await claimPendingEmailEvents();

      expect(claimed).toEqual([]);
      expect(find("SET status = 'sending'")).toBeUndefined();
      expect(statements()[statements().length - 1]).toBe('COMMIT');
    });

    it('rolls back, releases the connection and rethrows when the query fails', async () => {
      db.state.handler = sql => {
        if (sql.includes('SKIP LOCKED')) {
          throw new Error('claim failed');
        }
        return undefined;
      };

      await expect(claimPendingEmailEvents()).rejects.toThrow('claim failed');

      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
      expect(db.client.release).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('still reports the original error when the rollback itself fails', async () => {
      db.state.handler = sql => {
        if (sql.includes('SKIP LOCKED')) {
          throw new Error('claim failed');
        }
        if (sql.trim() === 'ROLLBACK') {
          throw new Error('rollback failed');
        }
        return undefined;
      };

      await expect(claimPendingEmailEvents()).rejects.toThrow('claim failed');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('markEmailSent (stage B)', () => {
    it('stores the provider message id and the sent status', async () => {
      await markEmailSent('e1', 'msg-123');

      const update = find("SET status = 'sent'")!;
      expect(update.params).toEqual(['e1', 'msg-123']);
      expect(update.sql.replace(/\s+/g, ' ')).toContain('provider_message_id = $2');
      expect(update.sql).toContain('sent_at = CURRENT_TIMESTAMP');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('rethrows a database error after releasing the connection', async () => {
      db.state.handler = () => {
        throw new Error('update failed');
      };

      await expect(markEmailSent('e1', 'msg-123')).rejects.toThrow('update failed');
      expect(db.client.release).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('scheduleEmailRetry (stage B)', () => {
    interface Row {
      retry_count: number;
      status: string;
      last_error: string | null;
    }

    let row: Row | null;
    let delays: number[];

    beforeEach(() => {
      row = { retry_count: 0, status: 'sending', last_error: null };
      delays = [];

      db.state.handler = (sql, params) => {
        const text = sql.replace(/\s+/g, ' ');
        if (text.includes('SELECT retry_count FROM email_events')) {
          return { rows: row ? [{ retry_count: row.retry_count }] : [] };
        }
        if (text.includes("SET status = 'pending'")) {
          row!.status = 'pending';
          row!.retry_count = params[1] as number;
          row!.last_error = params[2] as string;
          delays.push(Number(/INTERVAL '(\d+) minutes'/.exec(text)![1]));
          return { rows: [] };
        }
        if (text.includes("SET status = 'failed'")) {
          row!.status = 'failed';
          row!.last_error = params[1] as string;
          return { rows: [] };
        }
        return undefined;
      };
    });

    const failOnce = async (message = 'SendGrid API error: boom') => {
      row!.status = 'sending';
      await scheduleEmailRetry('e1', message);
    };

    it('schedules the first retry after 1 minute and counts it', async () => {
      await failOnce();

      expect(row).toEqual({ retry_count: 1, status: 'pending', last_error: 'SendGrid API error: boom' });
      expect(delays).toEqual([1]);
    });

    it('backs off 1, 2 and 4 minutes, then gives up: four attempts in total', async () => {
      const statusAfterEachFailure: string[] = [];

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await failOnce(`failure ${attempt}`);
        statusAfterEachFailure.push(`${row!.status}:${row!.retry_count}`);
      }

      expect(delays).toEqual([1, 2, 4]);
      expect(statusAfterEachFailure).toEqual(['pending:1', 'pending:2', 'pending:3', 'failed:3']);
      expect(row!.last_error).toBe('failure 4');
    });

    it('never raises retry_count above 3', async () => {
      for (let i = 0; i < 8; i += 1) {
        await failOnce();
      }

      expect(row!.retry_count).toBe(3);
      expect(row!.status).toBe('failed');
    });

    it('does nothing for an unknown event', async () => {
      row = null;

      await scheduleEmailRetry('missing', 'x');

      expect(find("SET status = 'pending'")).toBeUndefined();
      expect(find("SET status = 'failed'")).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('passes the error text as a parameter, not inside the SQL', async () => {
      await failOnce("x'; DROP TABLE email_events; --");

      const update = find("SET status = 'pending'")!;
      expect(update.params).toContain("x'; DROP TABLE email_events; --");
      expect(update.sql).not.toContain('DROP TABLE');
    });

    it('rethrows a database error after releasing the connection', async () => {
      db.state.handler = () => {
        throw new Error('db down');
      };

      await expect(scheduleEmailRetry('e1', 'x')).rejects.toThrow('db down');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('recoverStaleEmailEvents', () => {
    const original = config.emailWorker.staleTimeoutMs;

    afterEach(() => {
      config.emailWorker.staleTimeoutMs = original;
    });

    it('recovers events stuck in sending longer than the configured timeout', async () => {
      config.emailWorker.staleTimeoutMs = 120000;

      await recoverStaleEmailEvents();

      const update = find("WHERE status = 'sending'")!;
      expect(update.sql.replace(/\s+/g, ' ')).toContain("updated_at < CURRENT_TIMESTAMP - INTERVAL '120 seconds'");
      expect(update.sql).toContain("last_error = 'Recovered from stale sending state'");
    });

    it('uses the 5 minute default', async () => {
      config.emailWorker.staleTimeoutMs = 300000;

      await recoverStaleEmailEvents();

      expect(find("INTERVAL '300 seconds'")).toBeDefined();
    });

    it('sends events with retries left back to pending and fails the ones that used them up', async () => {
      await recoverStaleEmailEvents();

      const sql = find("WHERE status = 'sending'")!.sql.replace(/\s+/g, ' ');
      expect(sql).toContain("WHEN retry_count < 3 THEN 'pending'");
      expect(sql).toContain("WHEN retry_count = 3 THEN 'failed'");
      expect(sql).toContain("ELSE 'failed'");
      expect(sql).toContain("WHEN retry_count < 3 THEN CURRENT_TIMESTAMP + INTERVAL '1 minute'");
    });

    it('reports how many events it recovered', async () => {
      db.state.handler = sql => (sql.includes("status = 'sending'") ? { rows: [], rowCount: 3 } : undefined);

      await recoverStaleEmailEvents();

      expect(infoSpy).toHaveBeenCalledWith('Recovered stale email events', { count: 3 });
    });

    it('does not throw when the database fails: it is a background task', async () => {
      db.state.handler = () => {
        throw new Error('db down');
      };

      await expect(recoverStaleEmailEvents()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });
  });
});
