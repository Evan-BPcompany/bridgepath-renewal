import fs from 'fs';
import path from 'path';
import {
  ESTIMATE_STATUSES,
  STATUS_TRANSITIONS,
  RETIRED_STATUSES,
  checkTransition,
  findTransition,
  isEstimateStatus,
  isRetiredStatus
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
  it('uses exactly the statuses of the estimates.status CHECK constraint that migration 013 creates', () => {
    const migration = readSource('db', 'migrations', '013_align_estimate_statuses.ts');
    const listMatch = migration.match(/const NEW_STATUSES = \[([\s\S]*?)\];/);
    expect(listMatch).not.toBeNull();

    const dbStatuses = [...listMatch![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

    expect([...ESTIMATE_STATUSES].sort()).toEqual([...dbStatuses].sort());
    expect(ESTIMATE_STATUSES).toHaveLength(10);
  });

  it('is the ten statuses of PRD FR-5.5, and the retired ones are gone from the set', () => {
    expect([...ESTIMATE_STATUSES].sort()).toEqual(
      [
        'new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted',
        'customer_review', 'accepted', 'on_hold', 'completed', 'cancelled'
      ].sort()
    );
    for (const retired of RETIRED_STATUSES) {
      expect(isEstimateStatus(retired)).toBe(false);
      expect(isRetiredStatus(retired)).toBe(true);
    }
    expect([...RETIRED_STATUSES].sort()).toEqual(['archived', 'negotiating', 'rejected']);
    for (const current of ESTIMATE_STATUSES) {
      expect(isRetiredStatus(current)).toBe(false);
    }
    expect(isRetiredStatus(null)).toBe(false);
    expect(isRetiredStatus(undefined)).toBe(false);
    expect(isRetiredStatus('Rejected')).toBe(false);
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
    expect(STATUS_TRANSITIONS).toHaveLength(28);
  });

  it('completed and cancelled are end points: nothing leaves them', () => {
    expect(STATUS_TRANSITIONS.filter(t => t.from === 'completed' || t.from === 'cancelled')).toHaveLength(0);
  });

  it('mentions no retired status', () => {
    for (const t of STATUS_TRANSITIONS) {
      expect(isRetiredStatus(t.from)).toBe(false);
      expect(isRetiredStatus(t.to)).toBe(false);
    }
  });

  it('lets a quote be accepted directly and through the customer review', () => {
    expect(findTransition('quoted', 'accepted')).toEqual({
      from: 'quoted', to: 'accepted', managerAllowed: true, reasonRequired: false
    });
    expect(findTransition('quoted', 'customer_review')).toBeDefined();
    expect(findTransition('customer_review', 'accepted')).toBeDefined();
  });

  it('has exactly the approved next statuses for each status', () => {
    const next = (from: string) => STATUS_TRANSITIONS.filter(t => t.from === from).map(t => t.to).sort();

    expect(next('new_receipt')).toEqual(['cancelled', 'under_review']);
    expect(next('under_review')).toEqual(['cancelled', 'factory_checking', 'info_requested', 'on_hold', 'quoted']);
    expect(next('info_requested')).toEqual(['cancelled', 'on_hold', 'under_review']);
    expect(next('factory_checking')).toEqual(['cancelled', 'info_requested', 'on_hold', 'quoted']);
    expect(next('quoted')).toEqual(['accepted', 'cancelled', 'customer_review', 'on_hold']);
    expect(next('customer_review')).toEqual(['accepted', 'cancelled', 'factory_checking', 'on_hold', 'quoted']);
    expect(next('accepted')).toEqual(['cancelled', 'completed', 'on_hold']);
    expect(next('on_hold')).toEqual(['cancelled', 'under_review']);
    expect(next('completed')).toEqual([]);
    expect(next('cancelled')).toEqual([]);
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

  it('requires a reason for on_hold, cancelled and completed (accepted -> completed)', () => {
    for (const t of STATUS_TRANSITIONS) {
      const mustHaveReason = ['on_hold', 'cancelled', 'completed'].includes(t.to);
      expect(t.reasonRequired).toBe(mustHaveReason);
    }
  });

  it('only lets admin cancel', () => {
    for (const t of STATUS_TRANSITIONS) {
      const adminOnly = t.to === 'cancelled';
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

  it('rejects every transition out of the end points completed and cancelled', () => {
    for (const from of ['completed', 'cancelled'] as const) {
      for (const to of ESTIMATE_STATUSES) {
        expect(checkTransition(from, to, 'admin', 'reason').ok).toBe(false);
      }
    }
  });

  it('refuses the new statuses where the table has no line', () => {
    expect(checkTransition('new_receipt', 'info_requested', 'admin', undefined)).toEqual({
      ok: false,
      error: { http: 422, code: 'INVALID_TRANSITION' }
    });
    expect(checkTransition('info_requested', 'factory_checking', 'admin', undefined).ok).toBe(false);
    expect(checkTransition('quoted', 'factory_checking', 'admin', undefined).ok).toBe(false);
  });

  it('lets a manager move work through the new statuses, with a reason only for on_hold', () => {
    expect(checkTransition('under_review', 'info_requested', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('under_review', 'factory_checking', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('info_requested', 'under_review', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('factory_checking', 'quoted', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('quoted', 'customer_review', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('customer_review', 'accepted', 'manager', undefined).ok).toBe(true);
    expect(checkTransition('customer_review', 'on_hold', 'manager', undefined)).toEqual({
      ok: false,
      error: { http: 422, code: 'REASON_REQUIRED' }
    });
    expect(checkTransition('customer_review', 'on_hold', 'manager', 'waiting for the buyer').ok).toBe(true);
  });

  it('only an admin may cancel from every status that allows it, and always with a reason', () => {
    for (const from of ['new_receipt', 'under_review', 'info_requested', 'factory_checking', 'quoted', 'customer_review', 'accepted', 'on_hold'] as const) {
      expect(checkTransition(from, 'cancelled', 'manager', 'reason')).toEqual({
        ok: false,
        error: { http: 403, code: 'INSUFFICIENT_ROLE' }
      });
      expect(checkTransition(from, 'cancelled', 'admin', undefined)).toEqual({
        ok: false,
        error: { http: 422, code: 'REASON_REQUIRED' }
      });
      expect(checkTransition(from, 'cancelled', 'admin', 'reason').ok).toBe(true);
    }
  });

  it('refuses the retired statuses as a target (they are not statuses any more)', () => {
    expect(isEstimateStatus('rejected')).toBe(false);
    expect(isEstimateStatus('archived')).toBe(false);
    expect(isEstimateStatus('negotiating')).toBe(false);
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

  it('agrees with findTransition for all 100 status pairs (10 x 10)', () => {
    for (const from of ESTIMATE_STATUSES) {
      for (const to of ESTIMATE_STATUSES) {
        const listed = findTransition(from, to) !== undefined;
        const result = checkTransition(from, to, 'admin', 'reason');
        expect(result.ok).toBe(listed);
      }
    }
  });
});
