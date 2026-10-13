import fs from 'fs';
import path from 'path';
import {
  ESTIMATE_STATUSES,
  STATUS_TRANSITIONS,
  checkTransition,
  findTransition,
  isEstimateStatus
} from '../utils/statusTransitions';

const readSource = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

function parseReadmeTransitions(): Array<{
  from: string;
  to: string;
  manager: boolean;
  admin: boolean;
  reason: boolean;
}> {
  const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
  const match = readme.match(/<!-- STATUS_TRANSITIONS:START -->([\s\S]*?)<!-- STATUS_TRANSITIONS:END -->/);
  if (!match) {
    throw new Error('README status transition markers not found');
  }

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && !line.startsWith('|---') && !line.includes('Current status'))
    .map(line => {
      const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      return {
        from: cells[0],
        to: cells[1],
        manager: cells[2] === 'allowed',
        admin: cells[3] === 'allowed',
        reason: cells[4] === 'yes'
      };
    });
}

describe('Status transition table', () => {
  it('uses exactly the statuses of the estimates.status CHECK constraint', () => {
    const migration = readSource('db', 'migrations', '001_init_schema.ts');
    const checkMatch = migration.match(/status VARCHAR\(50\) NOT NULL DEFAULT 'new_receipt' CHECK \(status IN \(([\s\S]*?)\)\)/);
    expect(checkMatch).not.toBeNull();

    const dbStatuses = [...checkMatch![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

    expect([...ESTIMATE_STATUSES].sort()).toEqual([...dbStatuses].sort());
    expect(ESTIMATE_STATUSES).toHaveLength(10);
  });

  it('only references known statuses and has no duplicate pairs', () => {
    const seen = new Set<string>();
    for (const t of STATUS_TRANSITIONS) {
      expect(isEstimateStatus(t.from)).toBe(true);
      expect(isEstimateStatus(t.to)).toBe(true);
      expect(t.from).not.toBe(t.to);
      const key = `${t.from}->${t.to}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(STATUS_TRANSITIONS).toHaveLength(25);
  });

  it('has no transitions out of archived', () => {
    expect(STATUS_TRANSITIONS.filter(t => t.from === 'archived')).toHaveLength(0);
  });

  it('matches the README table row by row', () => {
    const readmeRows = parseReadmeTransitions();

    expect(readmeRows).toHaveLength(STATUS_TRANSITIONS.length);

    readmeRows.forEach((row, index) => {
      const code = STATUS_TRANSITIONS[index];
      expect(row.from).toBe(code.from);
      expect(row.to).toBe(code.to);
      expect(row.manager).toBe(code.managerAllowed);
      expect(row.admin).toBe(true);
      expect(row.reason).toBe(code.reasonRequired);
    });
  });

  it('requires a reason for on_hold, cancelled, rejected and completed', () => {
    for (const t of STATUS_TRANSITIONS) {
      const mustHaveReason = ['on_hold', 'cancelled', 'rejected', 'completed'].includes(t.to);
      expect(t.reasonRequired).toBe(mustHaveReason);
    }
  });

  it('only lets admin cancel, reject or archive', () => {
    for (const t of STATUS_TRANSITIONS) {
      const adminOnly = ['cancelled', 'rejected', 'archived'].includes(t.to);
      expect(t.managerAllowed).toBe(!adminOnly);
    }
  });
});

describe('checkTransition', () => {
  it('rejects the same status with SAME_STATUS (422)', () => {
    const result = checkTransition('quoted', 'quoted', 'admin', undefined);
    expect(result).toEqual({ ok: false, error: { http: 422, code: 'SAME_STATUS' } });
  });

  it('rejects unlisted transitions with INVALID_TRANSITION (422)', () => {
    const result = checkTransition('new_receipt', 'completed', 'admin', 'x');
    expect(result).toEqual({ ok: false, error: { http: 422, code: 'INVALID_TRANSITION' } });
  });

  it('rejects every transition out of archived', () => {
    for (const to of ESTIMATE_STATUSES) {
      const result = checkTransition('archived', to, 'admin', 'reason');
      expect(result.ok).toBe(false);
    }
  });

  it('rejects manager on admin-only transitions with INSUFFICIENT_ROLE (403)', () => {
    const result = checkTransition('under_review', 'cancelled', 'manager', 'customer asked');
    expect(result).toEqual({ ok: false, error: { http: 403, code: 'INSUFFICIENT_ROLE' } });
  });

  it('checks the role before the reason', () => {
    const result = checkTransition('under_review', 'cancelled', 'manager', undefined);
    expect(result).toEqual({ ok: false, error: { http: 403, code: 'INSUFFICIENT_ROLE' } });
  });

  it('requires a reason when the table says so (422)', () => {
    const result = checkTransition('under_review', 'on_hold', 'manager', undefined);
    expect(result).toEqual({ ok: false, error: { http: 422, code: 'REASON_REQUIRED' } });
  });

  it('requires a reason for accepted -> completed', () => {
    expect(checkTransition('accepted', 'completed', 'manager', undefined).ok).toBe(false);
    expect(checkTransition('accepted', 'completed', 'manager', 'delivered').ok).toBe(true);
  });

  it('allows manager on normal flow without a reason', () => {
    expect(checkTransition('new_receipt', 'under_review', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('under_review', 'quoted', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('quoted', 'accepted', 'manager', undefined).ok).toBe(true);
  });

  it('allows admin on every listed transition when a reason is supplied', () => {
    for (const t of STATUS_TRANSITIONS) {
      expect(checkTransition(t.from, t.to, 'admin', 'reason').ok).toBe(true);
    }
  });

  it('agrees with findTransition for all 100 status pairs', () => {
    for (const from of ESTIMATE_STATUSES) {
      for (const to of ESTIMATE_STATUSES) {
        const listed = findTransition(from, to) !== undefined;
        const result = checkTransition(from, to, 'admin', 'reason');
        expect(result.ok).toBe(listed);
      }
    }
  });
});
