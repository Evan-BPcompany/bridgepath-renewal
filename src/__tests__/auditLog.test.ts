import logger from '../utils/logger';
import { buildAuditRecord, logAdminAudit, AuditEntry } from '../utils/auditLog';

describe('Admin audit log', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps only whitelisted keys', () => {
    const entry = {
      action: 'memo.create',
      result: 'success',
      admin_id: 'admin-1',
      estimate_id: 'est-1',
      content: 'private memo text',
      body: '<html>email body</html>',
      password: 'hunter2',
      access_token: 'abc',
      refresh_token: 'def',
      customer_email: 'buyer@example.com',
      reason: 'secret reason'
    } as unknown as AuditEntry;

    const record = buildAuditRecord(entry);

    expect(Object.keys(record).sort()).toEqual(['action', 'admin_id', 'estimate_id', 'result']);
    expect(JSON.stringify(record)).not.toMatch(/private memo|email body|hunter2|abc|buyer@|secret reason/);
  });

  it('drops non-primitive values and truncates long strings', () => {
    const entry = {
      action: 'x'.repeat(500),
      result: 'success',
      estimate_id: { nested: 'object' }
    } as unknown as AuditEntry;

    const record = buildAuditRecord(entry);

    expect((record.action as string).length).toBe(100);
    expect(record.estimate_id).toBeUndefined();
  });

  it('logs successes at info level and everything else at warn level', () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    logAdminAudit({ action: 'estimate.detail.view', result: 'success' });
    logAdminAudit({ action: 'file.access.attempt', result: 'denied', http_status: 403 });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/^admin_audit \{.*"action":"estimate.detail.view"/);
    expect(String(warn.mock.calls[0][0])).toContain('"http_status":403');
  });
});
