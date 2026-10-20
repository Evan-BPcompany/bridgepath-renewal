jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/emailService', () => ({ queueEmailInTransaction: jest.fn() }));
jest.mock('../utils/receipt-id', () => ({
  generateReceiptIdInTransaction: jest.fn(async () => 'BP20261013001')
}));

import { getPool } from '../config/database';
import { config } from '../config/env';
import logger from '../utils/logger';
import { queueEmailInTransaction } from '../services/emailService';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { hashEstimateToken } from '../utils/token';
import { createFakeDb } from './helpers/adminTestUtils';
import { SERVICE_PROFILE } from './helpers/customerFixtures';
import { generateReceiptIdInTransaction } from '../utils/receipt-id';

const queueEmail = queueEmailInTransaction as jest.Mock;
const CREATED_AT = new Date('2026-10-13T03:00:00Z');
const ORIGINAL_ADMIN_EMAIL = config.adminNotificationEmail;

describe('estimate service (fake database)', () => {
  let db: ReturnType<typeof createFakeDb>;

  const statements = () => db.client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' ').trim());
  const find = (needle: string) => db.state.queries.find(q => q.sql.replace(/\s+/g, ' ').includes(needle));

  beforeEach(() => {
    db = createFakeDb();
    (getPool as jest.Mock).mockReturnValue(db.pool);
    queueEmail.mockReset();
    (generateReceiptIdInTransaction as jest.Mock).mockClear();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    config.adminNotificationEmail = ORIGINAL_ADMIN_EMAIL;
  });

  describe('createEstimate', () => {
    const request = {
      ...SERVICE_PROFILE,
      category: 'shoes',
      specification_json: { quantity: 500 },
      customer_name: 'Kim',
      customer_email: 'buyer@example.com',
      customer_phone: '010-1234-5678',
      company_name: 'Acme'
    };

    beforeEach(() => {
      config.adminNotificationEmail = 'admin@example.com';
      db.state.handler = sql => {
        if (sql.includes('INSERT INTO estimates')) {
          return { rows: [{ id: 'est-1', receipt_id: 'BP20261013001', status: 'new_receipt', created_at: CREATED_AT }] };
        }
        if (sql.includes('INSERT INTO estimate_access_tokens')) {
          return { rows: [{ id: 'tok-1' }] };
        }
        return undefined;
      };
    });

    it('creates the estimate, its access token and the email events in one READ COMMITTED transaction', async () => {
      const result = await createEstimate(request);

      const order = statements();
      expect(order[0]).toBe('BEGIN');
      expect(order.join('\n')).not.toContain('SERIALIZABLE');
      expect(generateReceiptIdInTransaction).toHaveBeenCalledWith(db.client);
      expect(order[1]).toContain('INSERT INTO estimates');
      expect(order[2]).toContain('INSERT INTO estimate_access_tokens');
      expect(order[order.length - 1]).toBe('COMMIT');
      expect(queueEmail).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        success: true,
        receipt_id: 'BP20261013001',
        estimate_id: 'est-1',
        created_at: '2026-10-13T03:00:00.000Z'
      });
      // The internal status stays in the database (new_receipt); the customer-facing result has none.
      expect(result).not.toHaveProperty('status');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('stores the customer details with the receipt id and the specification as JSON', async () => {
      await createEstimate(request);

      expect(find('INSERT INTO estimates')!.params).toEqual([
        'BP20261013001',
        'shoes',
        'Kim',
        'buyer@example.com',
        '010-1234-5678',
        'Acme',
        JSON.stringify({ quantity: 500 }),
        'individual_startup',
        'dev-draft',
        // No estimate id of its own: the database makes one.
        null
      ]);
    });

    it('stores the customer type and the consent version, and stamps the consent time with the database time', async () => {
      await createEstimate({
        ...request,
        customer_type: 'business_brand',
        privacy_consent_version: '2026-v1',
        // Not part of the request type: whatever a caller adds must not reach the database.
        ...({ privacy_consent_at: '1999-01-01T00:00:00Z', privacy_consent: true } as object)
      });

      const insert = find('INSERT INTO estimates')!;
      expect(insert.sql.replace(/\s+/g, ' ')).toContain(
        'customer_type, privacy_consent_at, privacy_consent_version'
      );
      expect(insert.sql.replace(/\s+/g, ' ')).toContain("'new_receipt', $8, CURRENT_TIMESTAMP, $9)");
      expect(insert.params).toHaveLength(10);
      expect(insert.params.slice(7, 9)).toEqual(['business_brand', '2026-v1']);
      expect(JSON.stringify(insert.params)).not.toContain('1999');
    });

    describe('with files that are already in the storage', () => {
      const stored = ['a', 'b'].map(name => ({
        id: name.repeat(32),
        estimateId: '8a1b7c1e-5f0e-4c36-9d57-0d8f3f1a2b3c',
        s3Key: `estimates/8a1b7c1e-5f0e-4c36-9d57-0d8f3f1a2b3c/${name.repeat(32)}.png`,
        filename: `${name}.png`,
        mimeType: 'image/png',
        fileSize: 12,
        status: 'quarantine'
      }));

      it('creates the estimate with the id the files were stored under, and the file rows in the same transaction', async () => {
        await createEstimate({ ...request, estimate_id: stored[0].estimateId, files: stored });

        expect(find('INSERT INTO estimates')!.params[9]).toBe(stored[0].estimateId);
        const order = statements();
        const tokenAt = order.findIndex(sql => sql.includes('INSERT INTO estimate_access_tokens'));
        const fileRows = order.map((sql, index) => (sql.includes('INSERT INTO files') ? index : -1)).filter(index => index >= 0);
        expect(order[0]).toBe('BEGIN');
        expect(fileRows).toHaveLength(2);
        expect(fileRows[0]).toBeGreaterThan(tokenAt);
        expect(order[order.length - 1]).toBe('COMMIT');
        expect(order.filter(sql => sql === 'BEGIN')).toHaveLength(1);
      });

      it('writes no file row for a request without files', async () => {
        await createEstimate({ ...request, files: [] });

        expect(statements().some(sql => sql.includes('INSERT INTO files'))).toBe(false);
      });

      it('rolls the whole request back when a file row cannot be written: no estimate, no receipt', async () => {
        const original = db.state.handler;
        db.state.handler = (sql, params) => {
          if (sql.includes('INSERT INTO files')) {
            throw new Error('insert or update on table "files" violates foreign key');
          }
          return original(sql, params);
        };

        await expect(createEstimate({ ...request, estimate_id: stored[0].estimateId, files: stored })).rejects.toThrow('violates');

        const order = statements();
        expect(order).toContain('ROLLBACK');
        expect(order).not.toContain('COMMIT');
        expect(db.client.release).toHaveBeenCalled();
      });
    });

    it('stores NULL for contact details that were not given', async () => {
      await createEstimate({ ...SERVICE_PROFILE, category: 'shoes', specification_json: {}, customer_phone: '010-1234-5678' });

      const params = find('INSERT INTO estimates')!.params;
      expect(params.slice(2, 6)).toEqual([null, null, '010-1234-5678', null]);
    });

    it('returns a random access token and stores only its SHA-256 hash', async () => {
      const first = await createEstimate(request);
      const second = await createEstimate(request);

      expect(first.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(second.access_token).not.toBe(first.access_token);

      const stored = db.state.queries.filter(q => q.sql.includes('INSERT INTO estimate_access_tokens'));
      expect(stored[0].params).toEqual(['est-1', 'BP20261013001', hashEstimateToken(first.access_token)]);

      // The raw token must not appear in any SQL parameter.
      const everything = JSON.stringify(db.state.queries.map(q => q.params));
      expect(everything).not.toContain(first.access_token);
      expect(everything).not.toContain(second.access_token);
    });

    it('queues the emails through the same client, so they commit or roll back with the estimate', async () => {
      await createEstimate(request);

      for (const call of queueEmail.mock.calls) {
        expect(call[0]).toBe(db.client);
      }
      expect(queueEmail.mock.calls.map(call => call[1].idempotency_key)).toEqual(['receipt-est-1', 'admin-est-1']);
    });

    it('queues only the customer receipt when no admin address is configured', async () => {
      config.adminNotificationEmail = undefined;

      await createEstimate(request);

      expect(queueEmail.mock.calls.map(call => call[1].email_type)).toEqual(['receipt']);
    });

    it('rolls everything back when queuing an email fails', async () => {
      queueEmail.mockRejectedValue(new Error('outbox down'));

      await expect(createEstimate(request)).rejects.toThrow('outbox down');

      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back when the estimate cannot be inserted', async () => {
      db.state.handler = sql => {
        if (sql.includes('INSERT INTO estimates')) {
          throw new Error('constraint violated');
        }
        return undefined;
      };

      await expect(createEstimate(request)).rejects.toThrow('constraint violated');

      expect(statements()).toContain('ROLLBACK');
      expect(queueEmail).not.toHaveBeenCalled();
    });

    it('createEstimate fails when the insert returns no row', async () => {
      db.state.handler = sql => (sql.includes('INSERT INTO estimates') ? { rows: [] } : undefined);

      await expect(createEstimate(request)).rejects.toThrow('Failed to create estimate');
      expect(statements()).toContain('ROLLBACK');
    });

    describe('retries of the whole transaction (one try plus 3 retries)', () => {
      const failFirstInserts = (times: number, code: string, constraint?: string) => {
        let remaining = times;
        const original = db.state.handler;
        db.state.handler = (sql, params) => {
          if (sql.includes('INSERT INTO estimates') && remaining > 0) {
            remaining -= 1;
            throw Object.assign(new Error('contention'), { code, constraint });
          }
          return original(sql, params);
        };
      };

      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('runs the whole transaction again after 40001 and keeps the result of the last attempt only', async () => {
        failFirstInserts(3, '40001');

        const pending = createEstimate(request);
        await jest.advanceTimersByTimeAsync(10 + 20 + 40);
        const result = await pending;

        expect(db.pool.connect).toHaveBeenCalledTimes(4);
        expect(db.client.release).toHaveBeenCalledTimes(4);
        expect(statements().filter(s => s === 'BEGIN')).toHaveLength(4);
        expect(statements().filter(s => s === 'ROLLBACK')).toHaveLength(3);
        expect(statements().filter(s => s === 'COMMIT')).toHaveLength(1);
        expect(generateReceiptIdInTransaction).toHaveBeenCalledTimes(4);
        // The response comes from the attempt that committed.
        expect(result.estimate_id).toBe('est-1');
      });

      it('gives up after four attempts and reports SQLSTATE 40001 with the attempt count', async () => {
        failFirstInserts(10, '40001');

        const pending = createEstimate(request);
        const assertion = expect(pending).rejects.toMatchObject({ code: '40001', attempts: 4 });
        await jest.advanceTimersByTimeAsync(1000);
        await assertion;

        expect(db.pool.connect).toHaveBeenCalledTimes(4);
        expect(statements()).not.toContain('COMMIT');
      });

      it('retries a collision on the receipt_sequence date constraint (23505) but no other unique violation', async () => {
        failFirstInserts(1, '23505', 'receipt_sequence_receipt_date_key');
        const retried = createEstimate(request);
        await jest.advanceTimersByTimeAsync(10);
        await expect(retried).resolves.toMatchObject({ success: true });
        expect(db.pool.connect).toHaveBeenCalledTimes(2);

        db.pool.connect.mockClear();
        for (const constraint of ['estimates_receipt_id_key', 'email_events_idempotency_key_key']) {
          db.pool.connect.mockClear();
          failFirstInserts(1, '23505', constraint);
          await expect(createEstimate(request)).rejects.toMatchObject({ code: '23505', constraint });
          expect(db.pool.connect).toHaveBeenCalledTimes(1);
        }
      });

      it('does not retry an error from COMMIT: the outcome is unknown and a retry could create a second estimate', async () => {
        const original = db.state.handler;
        db.state.handler = (sql, params) => {
          if (sql.trim() === 'COMMIT') {
            throw Object.assign(new Error('connection terminated'), { code: '57P01' });
          }
          return original(sql, params);
        };

        await expect(createEstimate(request)).rejects.toThrow('connection terminated');

        expect(db.pool.connect).toHaveBeenCalledTimes(1);
      });

      it('does not retry errors that are not contention', async () => {
        failFirstInserts(1, '23514');

        await expect(createEstimate(request)).rejects.toMatchObject({ code: '23514' });

        expect(db.pool.connect).toHaveBeenCalledTimes(1);
      });
    });

    it('does not write customer details to the log', async () => {
      await createEstimate(request);

      const logged = JSON.stringify([
        ...(logger.info as jest.Mock).mock.calls,
        ...(logger.error as jest.Mock).mock.calls
      ]);
      expect(logged).not.toContain('buyer@example.com');
      expect(logged).not.toContain('010-1234-5678');
      expect(logged).not.toContain('Kim');
    });
  });

  describe('getEstimateByReceiptId: a token is bound to its receipt and works once', () => {
    const TOKEN_HASH = hashEstimateToken('customer-token');
    const row = {
      receipt_id: 'BP20261013001',
      category: 'shoes',
      status: 'new_receipt',
      specification_json: { quantity: 500 },
      created_at: CREATED_AT,
      updated_at: CREATED_AT
    };

    it('consumes the token with one conditional UPDATE: right token, right receipt, unused, not expired', async () => {
      db.state.handler = sql => {
        if (sql.includes('UPDATE estimate_access_tokens')) {
          return { rows: [{ estimate_id: 'est-1' }] };
        }
        if (sql.includes('FROM estimates e')) {
          return { rows: [row] };
        }
        return undefined;
      };

      await getEstimateByReceiptId('BP20261013001', TOKEN_HASH);

      const update = find('UPDATE estimate_access_tokens')!;
      expect(update.params).toEqual([TOKEN_HASH, 'BP20261013001']);
      const sql = update.sql.replace(/\s+/g, ' ');
      expect(sql).toContain('WHERE token = $1 AND receipt_id = $2 AND is_used = false AND expires_at > CURRENT_TIMESTAMP');
      expect(sql).toContain('is_used = true');
      expect(sql).toContain('visit_count = visit_count + 1');
    });

    it('returns the estimate with ISO timestamps and commits', async () => {
      db.state.handler = sql => {
        if (sql.includes('UPDATE estimate_access_tokens')) {
          return { rows: [{ estimate_id: 'est-1' }] };
        }
        return sql.includes('FROM estimates e') ? { rows: [row] } : undefined;
      };

      const result = await getEstimateByReceiptId('BP20261013001', TOKEN_HASH);

      expect(result).toEqual({
        receipt_id: 'BP20261013001',
        category: 'shoes',
        specification_json: { quantity: 500 },
        created_at: '2026-10-13T03:00:00.000Z',
        updated_at: '2026-10-13T03:00:00.000Z'
      });
      expect(result).not.toHaveProperty('status');
      // The lookup does not even read the status column.
      const select = find('FROM estimates e')!;
      expect(select.sql).not.toMatch(/\bstatus\b/);
      expect(statements()[0]).toBe('BEGIN');
      expect(statements()[statements().length - 1]).toBe('COMMIT');
    });

    it('returns nothing for a wrong, used, expired or foreign token, and rolls back', async () => {
      // The UPDATE matches no row: that is how all four cases look to the service.
      const result = await getEstimateByReceiptId('BP20261013002', TOKEN_HASH);

      expect(result).toBeNull();
      expect(statements()).toContain('ROLLBACK');
      expect(statements()).not.toContain('COMMIT');
      expect(find('FROM estimates e')).toBeUndefined();
    });

    it('rolls back when the estimate row has disappeared', async () => {
      db.state.handler = sql => (sql.includes('UPDATE estimate_access_tokens') ? { rows: [{ estimate_id: 'est-1' }] } : undefined);

      expect(await getEstimateByReceiptId('BP20261013001', TOKEN_HASH)).toBeNull();
      expect(statements()).toContain('ROLLBACK');
    });

    it('rolls back, releases the connection and rethrows on a database error', async () => {
      db.state.handler = () => {
        throw new Error('db down');
      };

      await expect(getEstimateByReceiptId('BP20261013001', TOKEN_HASH)).rejects.toThrow('db down');
      expect(statements()).toContain('ROLLBACK');
      expect(db.client.release).toHaveBeenCalledTimes(1);
    });

    it('never selects the access token or its hash back out of the database', async () => {
      db.state.handler = sql => (sql.includes('UPDATE estimate_access_tokens') ? { rows: [{ estimate_id: 'est-1' }] } : undefined);

      await getEstimateByReceiptId('BP20261013001', TOKEN_HASH);

      const select = find('FROM estimates e');
      expect(select?.sql ?? '').not.toContain('token');
    });
  });
});
