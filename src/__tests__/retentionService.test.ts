jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { getPool } from '../config/database';
import { cleanupExpiredData, RETENTION_DAYS, startCleanupSchedule, stopCleanupSchedule } from '../services/retentionService';

describe('the cleanup of expired data (unit)', () => {
  const query = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    query.mockReset();
    query.mockResolvedValue({ rowCount: 2 });
    (getPool as jest.Mock).mockReturnValue({ query });
  });

  afterEach(() => {
    stopCleanupSchedule();
    jest.useRealTimers();
  });

  it('runs eight deletes with the days as a parameter, and reports how many rows each removed', async () => {
    const result = await cleanupExpiredData();

    expect(query).toHaveBeenCalledTimes(8);
    expect(result).toEqual({
      customer_sessions: 2,
      customer_email_codes: 2,
      admin_sessions: 2,
      estimate_access_tokens: 2,
      email_events_sent: 2,
      email_events_failed: 2,
      kakao_events_sent: 2,
      kakao_events_failed: 2
    });
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/^DELETE FROM /);
      expect(sql).toContain('$1');
      expect(typeof params[0]).toBe('number');
    }
  });

  it('touches only the temporary tables: never customers, estimates, quotes or inquiries', async () => {
    await cleanupExpiredData();

    const tables = query.mock.calls.map(([sql]) => /DELETE FROM (\w+)/.exec(sql)![1]);
    expect([...new Set(tables)].sort()).toEqual(['admin_sessions', 'customer_email_codes', 'customer_sessions', 'email_events', 'estimate_access_tokens', 'kakao_events']);
  });

  it('never deletes an e-mail that is pending or sending: only sent and failed ones', async () => {
    await cleanupExpiredData();

    const emailSql = query.mock.calls.map(([sql]) => sql as string).filter(sql => /email_events|kakao_events/.test(sql));
    expect(emailSql).toHaveLength(4);
    for (const sql of emailSql) {
      expect(sql).toMatch(/status = '(sent|failed)'/);
      expect(sql).not.toMatch(/pending|sending/);
    }
    expect(RETENTION_DAYS.failedEmails).toBeGreaterThan(RETENTION_DAYS.sentEmails);
  });

  it('runs a minute after the start and then every day, and a failure does not stop the schedule', async () => {
    startCleanupSchedule();
    startCleanupSchedule(); // a second start changes nothing

    expect(query).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60 * 1000);
    expect(query).toHaveBeenCalledTimes(8);

    query.mockRejectedValue(new Error('database down'));
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(query).toHaveBeenCalledTimes(9); // stopped at the first failure of that run

    query.mockResolvedValue({ rowCount: 0 });
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(query).toHaveBeenCalledTimes(17);
  });
});
