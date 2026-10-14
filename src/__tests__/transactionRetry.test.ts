import type { Pool } from 'pg';
import logger from '../utils/logger';
import {
  MAX_ATTEMPTS,
  RECEIPT_SEQUENCE_DATE_CONSTRAINT,
  RETRY_COUNT,
  TransactionRetryExhaustedError,
  isRetryableError,
  runInTransaction
} from '../utils/transactionRetry';

// One try plus 3 retries. The pool is a fake; the SQLSTATE decides, never the message.

const sqlError = (code: string, constraint?: string) =>
  Object.assign(new Error(`message in any language (${code})`), { code, constraint });

describe('runInTransaction', () => {
  let queries: string[];
  let release: jest.Mock;
  let connect: jest.Mock;
  let pool: Pool;
  let failCommit: unknown;
  const sleep = jest.fn(async () => undefined);

  beforeEach(() => {
    queries = [];
    failCommit = undefined;
    sleep.mockClear();
    release = jest.fn();
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql === 'COMMIT' && failCommit) {
          throw failCommit;
        }
        return { rows: [] };
      }),
      release
    };
    connect = jest.fn(async () => client);
    pool = { connect } as unknown as Pool;
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('means one try plus three retries, four attempts in total', () => {
    expect(RETRY_COUNT).toBe(3);
    expect(MAX_ATTEMPTS).toBe(4);
  });

  it('commits at the default isolation level and returns the result', async () => {
    await expect(runInTransaction(pool, async () => 'done', { sleep })).resolves.toBe('done');

    expect(queries).toEqual(['BEGIN', 'COMMIT']);
    expect(release).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries 40001 with 10, 20 and 40 ms back-off and succeeds on the fourth attempt', async () => {
    let calls = 0;
    const work = jest.fn(async () => {
      calls += 1;
      if (calls < 4) {
        throw sqlError('40001');
      }
      return calls;
    });

    await expect(runInTransaction(pool, work, { sleep })).resolves.toBe(4);

    expect(connect).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(4);
    expect(queries.filter(q => q === 'ROLLBACK')).toHaveLength(3);
    expect(sleep.mock.calls.map(call => (call as unknown as number[])[0])).toEqual([10, 20, 40]);
  });

  it('gives up after four attempts with the SQLSTATE and the real number of attempts', async () => {
    const work = jest.fn(async () => {
      throw sqlError('40001');
    });

    const failure = await runInTransaction(pool, work, { sleep }).catch(err => err);

    expect(failure).toBeInstanceOf(TransactionRetryExhaustedError);
    expect(failure).toMatchObject({ code: '40001', attempts: 4 });
    expect(work).toHaveBeenCalledTimes(4);
    expect(queries).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(4);
  });

  it('does not retry other errors and rethrows them unchanged', async () => {
    const original = sqlError('23514');

    await expect(runInTransaction(pool, async () => { throw original; }, { sleep })).rejects.toBe(original);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry an unclear error from COMMIT, but does retry a 40001 from COMMIT', async () => {
    failCommit = sqlError('57P01');
    await expect(runInTransaction(pool, async () => 1, { sleep })).rejects.toMatchObject({ code: '57P01' });
    expect(connect).toHaveBeenCalledTimes(1);

    connect.mockClear();
    failCommit = sqlError('40001');
    await expect(runInTransaction(pool, async () => 1, { sleep })).rejects.toMatchObject({ code: '40001', attempts: 4 });
    expect(connect).toHaveBeenCalledTimes(4);
  });

  it('survives a failing ROLLBACK and still reports the original error', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'ROLLBACK') {
          throw new Error('connection gone');
        }
        return { rows: [] };
      }),
      release
    };
    connect.mockResolvedValue(client);
    const original = sqlError('23514');

    await expect(runInTransaction(pool, async () => { throw original; }, { sleep })).rejects.toBe(original);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableError', () => {
  it.each([
    [sqlError('40001'), true],
    [sqlError('23505', RECEIPT_SEQUENCE_DATE_CONSTRAINT), true],
    [sqlError('23505', 'receipt_sequence_receipt_date_key'), true],
    [sqlError('23505', 'estimates_receipt_id_key'), false],
    [sqlError('23505', 'receipt_sequence_pkey'), false],
    [sqlError('23505', 'email_events_idempotency_key_key'), false],
    [sqlError('23505', 'admin_users_username_key'), false],
    [sqlError('23505', 'admin_users_email_key'), false],
    [sqlError('23505', 'estimate_access_tokens_token_key'), false],
    [sqlError('23505', 'my_receipt_thing'), false],
    [sqlError('23505'), false],
    [Object.assign(new Error('eine Verletzung'), { code: '23505', constraint: undefined }), false],
    [Object.assign(new Error('duplicate key value violates unique constraint "receipt_sequence_receipt_date_key"'), { code: '23000' }), false],
    [sqlError('23503'), false],
    [sqlError('40P01'), false],
    [new Error('no code'), false],
    [null, false]
  ])('%#', (err, expected) => {
    expect(isRetryableError(err)).toBe(expected);
  });
});
