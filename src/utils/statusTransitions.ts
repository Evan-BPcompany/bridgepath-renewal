// Source of truth for admin status changes. Keep in sync with the README table
// (enforced by statusTransitions.test.ts). The statuses are exactly the ones allowed by the
// estimates.status CHECK constraint as migration 013_align_estimate_statuses.ts leaves it
// (the ten statuses of PRD FR-5.5).
//
//   new_receipt       신규 접수            under_review      정보 확인 중
//   info_requested    추가정보 요청        factory_checking  공장 견적 확인 중
//   quoted            정식견적 발송        customer_review   고객 검토 중
//   accepted          진행 확정            on_hold           보류
//   completed         종결                 cancelled         취소

export const ESTIMATE_STATUSES = [
  'new_receipt',
  'under_review',
  'info_requested',
  'factory_checking',
  'quoted',
  'customer_review',
  'accepted',
  'on_hold',
  'completed',
  'cancelled'
] as const;

// Statuses that existed before migration 013 and are gone. No estimate has one any more, but
// status_history keeps the values it was written with (an audit trail is never rewritten), so
// an old history entry can still name one of them. Their equivalent today:
//   rejected -> cancelled, archived -> completed, negotiating -> customer_review.
export const RETIRED_STATUSES = ['rejected', 'archived', 'negotiating'] as const;

export function isRetiredStatus(value: unknown): boolean {
  return typeof value === 'string' && (RETIRED_STATUSES as readonly string[]).includes(value);
}

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
  { from: 'new_receipt', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'under_review', to: 'info_requested', managerAllowed: true, reasonRequired: false },
  { from: 'under_review', to: 'factory_checking', managerAllowed: true, reasonRequired: false },
  { from: 'under_review', to: 'quoted', managerAllowed: true, reasonRequired: false },
  { from: 'under_review', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'under_review', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'info_requested', to: 'under_review', managerAllowed: true, reasonRequired: false },
  { from: 'info_requested', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'info_requested', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'factory_checking', to: 'quoted', managerAllowed: true, reasonRequired: false },
  { from: 'factory_checking', to: 'info_requested', managerAllowed: true, reasonRequired: false },
  { from: 'factory_checking', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'factory_checking', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'quoted', to: 'customer_review', managerAllowed: true, reasonRequired: false },
  { from: 'quoted', to: 'accepted', managerAllowed: true, reasonRequired: false },
  { from: 'quoted', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'quoted', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'customer_review', to: 'accepted', managerAllowed: true, reasonRequired: false },
  { from: 'customer_review', to: 'quoted', managerAllowed: true, reasonRequired: false },
  { from: 'customer_review', to: 'factory_checking', managerAllowed: true, reasonRequired: false },
  { from: 'customer_review', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'customer_review', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'accepted', to: 'completed', managerAllowed: true, reasonRequired: true },
  { from: 'accepted', to: 'on_hold', managerAllowed: true, reasonRequired: true },
  { from: 'accepted', to: 'cancelled', managerAllowed: false, reasonRequired: true },
  { from: 'on_hold', to: 'under_review', managerAllowed: true, reasonRequired: false },
  { from: 'on_hold', to: 'cancelled', managerAllowed: false, reasonRequired: true }
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

export interface AllowedTransition {
  to: EstimateStatus;
  reason_required: boolean;
}

// The statuses this role may move an estimate to from `from`, in the order of STATUS_TRANSITIONS.
// The admin screen shows exactly these, so the rules live only here. A status without a row
// (a retired one) has no way on.
export function allowedTransitions(from: string, role: AdminRole): AllowedTransition[] {
  return STATUS_TRANSITIONS.filter(t => t.from === from && isRoleAllowed(role, t)).map(t => ({
    to: t.to,
    reason_required: t.reasonRequired
  }));
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
