// Source of truth for admin status changes. Keep in sync with the README table
// (enforced by statusTransitions.test.ts). Only statuses allowed by the
// estimates.status CHECK constraint (001_init_schema.ts) may appear here.

export const ESTIMATE_STATUSES = [
  'new_receipt',
  'under_review',
  'quoted',
  'negotiating',
  'accepted',
  'completed',
  'cancelled',
  'rejected',
  'on_hold',
  'archived'
] as const;

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export type AdminRole = 'admin' | 'manager';

export interface StatusTransition {
  from: EstimateStatus;
  to: EstimateStatus;
  managerAllowed: boolean;
  reasonRequired: boolean;
}

// admin may perform every listed transition; managerAllowed only widens access to manager.
export const STATUS_TRANSITIONS: readonly StatusTransition[] = [
  { from: 'new_receipt', to: 'under_review', managerAllowed: true, reasonRequired: false },
  { from: 'new_receipt', to: 'rejected', managerAllowed: false, reasonRequired: true },
  { from: 'new_receipt', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'under_review', to: 'quoted', managerAllowed: true, reasonRequired: false },
  { from: 'under_review', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'under_review', to: 'rejected', managerAllowed: false, reasonRequired: true },
  { from: 'under_review', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'quoted', to: 'negotiating', managerAllowed: true, reasonRequired: false },
  { from: 'quoted', to: 'accepted', managerAllowed: true, reasonRequired: false },
  { from: 'quoted', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'quoted', to: 'rejected', managerAllowed: false, reasonRequired: true },
  { from: 'quoted', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'negotiating', to: 'quoted', managerAllowed: true, reasonRequired: false },
  { from: 'negotiating', to: 'accepted', managerAllowed: true, reasonRequired: false },
  { from: 'negotiating', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'negotiating', to: 'rejected', managerAllowed: false, reasonRequired: true },
  { from: 'negotiating', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'accepted', to: 'completed', managerAllowed: true, reasonRequired: true },
  { from: 'accepted', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'accepted', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'on_hold', to: 'under_review', managerAllowed: true, reasonRequired: false },
  { from: 'on_hold', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'completed', to: 'archived', managerAllowed: false, reasonRequired: false },
  { from: 'rejected', to: 'archived', managerAllowed: false, reasonRequired: false },
  { from: 'cancelled', to: 'archived', managerAllowed: false, reasonRequired: false }
];

export const STATUS_REASON_MAX_LENGTH = 1000;

export const STATUS_ERRORS = {
  INVALID_ID: { http: 400, code: 'INVALID_ID' },
  INVALID_STATUS: { http: 400, code: 'INVALID_STATUS' },
  VALIDATION_ERROR: { http: 400, code: 'VALIDATION_ERROR' },
  ESTIMATE_NOT_FOUND: { http: 404, code: 'ESTIMATE_NOT_FOUND' },
  STATUS_CONFLICT: { http: 409, code: 'STATUS_CONFLICT' },
  SAME_STATUS: { http: 422, code: 'SAME_STATUS' },
  INVALID_TRANSITION: { http: 422, code: 'INVALID_TRANSITION' },
  INSUFFICIENT_ROLE: { http: 403, code: 'INSUFFICIENT_ROLE' },
  REASON_REQUIRED: { http: 422, code: 'REASON_REQUIRED' }
} as const;

export function isEstimateStatus(value: unknown): value is EstimateStatus {
  return typeof value === 'string' && (ESTIMATE_STATUSES as readonly string[]).includes(value);
}

export function findTransition(from: EstimateStatus, to: EstimateStatus): StatusTransition | undefined {
  return STATUS_TRANSITIONS.find(t => t.from === from && t.to === to);
}

export function isRoleAllowed(role: AdminRole, transition: StatusTransition): boolean {
  return role === 'admin' || transition.managerAllowed;
}

export type TransitionCheck =
  | { ok: true; transition: StatusTransition }
  | { ok: false; error: (typeof STATUS_ERRORS)[keyof typeof STATUS_ERRORS] };

// Evaluation order after the row is locked: same status, invalid transition, role, reason.
// (expected_status conflict is checked by the caller before this function.)
export function checkTransition(
  from: EstimateStatus,
  to: EstimateStatus,
  role: AdminRole,
  reason: string | undefined
): TransitionCheck {
  if (from === to) {
    return { ok: false, error: STATUS_ERRORS.SAME_STATUS };
  }

  const transition = findTransition(from, to);
  if (!transition) {
    return { ok: false, error: STATUS_ERRORS.INVALID_TRANSITION };
  }

  if (!isRoleAllowed(role, transition)) {
    return { ok: false, error: STATUS_ERRORS.INSUFFICIENT_ROLE };
  }

  if (transition.reasonRequired && !reason) {
    return { ok: false, error: STATUS_ERRORS.REASON_REQUIRED };
  }

  return { ok: true, transition };
}
