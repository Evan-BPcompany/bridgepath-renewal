import { Request, Response, NextFunction } from 'express';
import {
  isEstimateStatus,
  EstimateStatus,
  STATUS_REASON_MAX_LENGTH
} from '../utils/statusTransitions';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Allows newline and tab, rejects every other control character.
// eslint-disable-next-line no-control-regex
const REASON_FORBIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const CATEGORIES = ['eyewear', 'shoes', 'golf_products', 'other'] as const;
export const SORT_FIELDS = ['created_at', 'updated_at', 'status', 'receipt_id'] as const;

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 100;
export const SEARCH_MAX_LENGTH = 100;

export type SortField = (typeof SORT_FIELDS)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function sendError(
  res: Response,
  http: number,
  code: string,
  message: string,
  details?: unknown
): void {
  res.status(http).json({
    error: message,
    code,
    ...(details !== undefined ? { details } : {}),
    timestamp: new Date().toISOString()
  });
}

// State-changing admin requests must send JSON (part of the CSRF defence together
// with SameSite=Strict cookies and the CORS allow-list).
export function requireJson(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    return;
  }
  next();
}

export interface ListQuery {
  page: number;
  limit: number;
  statuses: EstimateStatus[];
  category?: string;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  sort: SortField;
  order: 'asc' | 'desc';
}

export type ListQueryResult =
  | { valid: true; value: ListQuery }
  | { valid: false; errors: Array<{ field: string; message: string }> };

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function singleString(
  raw: unknown,
  field: string,
  errors: Array<{ field: string; message: string }>
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'must be a single string value' });
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function integerParam(
  raw: string | undefined,
  field: string,
  fallback: number,
  min: number,
  max: number,
  errors: Array<{ field: string; message: string }>
): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    errors.push({ field, message: `must be an integer between ${min} and ${max}` });
    return fallback;
  }
  const n = Number(raw);
  if (n < min || n > max) {
    errors.push({ field, message: `must be an integer between ${min} and ${max}` });
    return fallback;
  }
  return n;
}

export function parseListQuery(query: Request['query']): ListQueryResult {
  const errors: Array<{ field: string; message: string }> = [];

  const page = integerParam(singleString(query.page, 'page', errors), 'page', 1, 1, 100000, errors);
  const limit = integerParam(
    singleString(query.limit, 'limit', errors),
    'limit',
    LIST_DEFAULT_LIMIT,
    1,
    LIST_MAX_LIMIT,
    errors
  );

  const statuses: EstimateStatus[] = [];
  const statusRaw = singleString(query.status, 'status', errors);
  if (statusRaw !== undefined) {
    for (const part of statusRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!isEstimateStatus(part)) {
        errors.push({ field: 'status', message: `unknown status: ${part.slice(0, 30)}` });
      } else if (!statuses.includes(part)) {
        statuses.push(part);
      }
    }
  }

  const category = singleString(query.category, 'category', errors);
  if (category !== undefined && !(CATEGORIES as readonly string[]).includes(category)) {
    errors.push({ field: 'category', message: `must be one of: ${CATEGORIES.join(', ')}` });
  }

  const createdFrom = singleString(query.created_from, 'created_from', errors);
  if (createdFrom !== undefined && !isRealDate(createdFrom)) {
    errors.push({ field: 'created_from', message: 'must be a valid date (YYYY-MM-DD)' });
  }

  const createdTo = singleString(query.created_to, 'created_to', errors);
  if (createdTo !== undefined && !isRealDate(createdTo)) {
    errors.push({ field: 'created_to', message: 'must be a valid date (YYYY-MM-DD)' });
  }

  if (
    createdFrom !== undefined &&
    createdTo !== undefined &&
    isRealDate(createdFrom) &&
    isRealDate(createdTo) &&
    createdFrom > createdTo
  ) {
    errors.push({ field: 'created_from', message: 'must not be after created_to' });
  }

  const search = singleString(query.q, 'q', errors);
  if (search !== undefined && search.length > SEARCH_MAX_LENGTH) {
    errors.push({ field: 'q', message: `must be at most ${SEARCH_MAX_LENGTH} characters` });
  }

  const sortRaw = singleString(query.sort, 'sort', errors);
  let sort: SortField = 'created_at';
  if (sortRaw !== undefined) {
    if ((SORT_FIELDS as readonly string[]).includes(sortRaw)) {
      sort = sortRaw as SortField;
    } else {
      errors.push({ field: 'sort', message: `must be one of: ${SORT_FIELDS.join(', ')}` });
    }
  }

  const orderRaw = singleString(query.order, 'order', errors);
  let order: 'asc' | 'desc' = 'desc';
  if (orderRaw !== undefined) {
    const lowered = orderRaw.toLowerCase();
    if (lowered === 'asc' || lowered === 'desc') {
      order = lowered;
    } else {
      errors.push({ field: 'order', message: 'must be asc or desc' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: { page, limit, statuses, category, createdFrom, createdTo, search, sort, order }
  };
}

export interface StatusChangeBody {
  toStatus: EstimateStatus;
  reason?: string;
  expectedStatus?: EstimateStatus;
}

export type StatusBodyResult =
  | { valid: true; value: StatusChangeBody }
  | { valid: false; code: 'INVALID_STATUS' | 'VALIDATION_ERROR'; message: string };

export function parseStatusBody(body: unknown): StatusBodyResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object' };
  }

  const { to_status, reason, expected_status } = body as Record<string, unknown>;

  if (to_status === undefined) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'to_status is required' };
  }

  if (!isEstimateStatus(to_status)) {
    return { valid: false, code: 'INVALID_STATUS', message: 'to_status is not a valid status' };
  }

  let expectedStatus: EstimateStatus | undefined;
  if (expected_status !== undefined && expected_status !== null) {
    if (!isEstimateStatus(expected_status)) {
      return {
        valid: false,
        code: 'INVALID_STATUS',
        message: 'expected_status is not a valid status'
      };
    }
    expectedStatus = expected_status;
  }

  let normalizedReason: string | undefined;
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== 'string') {
      return { valid: false, code: 'VALIDATION_ERROR', message: 'reason must be a string' };
    }
    const trimmed = reason.trim();
    if (trimmed.length > STATUS_REASON_MAX_LENGTH) {
      return {
        valid: false,
        code: 'VALIDATION_ERROR',
        message: `reason must be at most ${STATUS_REASON_MAX_LENGTH} characters`
      };
    }
    if (REASON_FORBIDDEN_CHARS.test(trimmed)) {
      return {
        valid: false,
        code: 'VALIDATION_ERROR',
        message: 'reason contains invalid control characters'
      };
    }
    normalizedReason = trimmed === '' ? undefined : trimmed;
  }

  return {
    valid: true,
    value: { toStatus: to_status, reason: normalizedReason, expectedStatus }
  };
}

export type PageQueryResult =
  | { valid: true; value: { page: number; limit: number } }
  | { valid: false; errors: Array<{ field: string; message: string }> };

export function parsePageQuery(query: Request['query']): PageQueryResult {
  const errors: Array<{ field: string; message: string }> = [];

  const page = integerParam(singleString(query.page, 'page', errors), 'page', 1, 1, 100000, errors);
  const limit = integerParam(
    singleString(query.limit, 'limit', errors),
    'limit',
    LIST_DEFAULT_LIMIT,
    1,
    LIST_MAX_LIMIT,
    errors
  );

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { page, limit } };
}

// GET /admin/inquiries: what the customers asked about the quotes, over all requests.
// status: open (the default: waiting for the staff), handled, or all; kind: question or consultation.
export interface InboxQuery {
  status: 'open' | 'handled' | 'all';
  kind?: 'question' | 'consultation';
  page: number;
  limit: number;
}

export type InboxQueryResult =
  | { valid: true; value: InboxQuery }
  | { valid: false; errors: Array<{ field: string; message: string }> };

export function parseInboxQuery(query: Request['query']): InboxQueryResult {
  const errors: Array<{ field: string; message: string }> = [];

  const page = integerParam(singleString(query.page, 'page', errors), 'page', 1, 1, 100000, errors);
  const limit = integerParam(singleString(query.limit, 'limit', errors), 'limit', LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT, errors);

  let status: InboxQuery['status'] = 'open';
  const statusRaw = singleString(query.status, 'status', errors);
  if (statusRaw !== undefined) {
    if (statusRaw === 'open' || statusRaw === 'handled' || statusRaw === 'all') {
      status = statusRaw;
    } else {
      errors.push({ field: 'status', message: 'must be open, handled or all' });
    }
  }

  let kind: InboxQuery['kind'];
  const kindRaw = singleString(query.kind, 'kind', errors);
  if (kindRaw !== undefined) {
    if (kindRaw === 'question' || kindRaw === 'consultation') {
      kind = kindRaw;
    } else {
      errors.push({ field: 'kind', message: 'must be question or consultation' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: { status, kind, page, limit } };
}

export type PasswordBodyResult =
  | { valid: true; currentPassword: string; newPassword: string }
  | { valid: false; message: string };

// Passwords are never trimmed or altered; only their type and presence are checked here.
export function parsePasswordChangeBody(body: unknown): PasswordBodyResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'Request body must be a JSON object' };
  }

  const { current_password, new_password } = body as Record<string, unknown>;

  if (typeof current_password !== 'string' || current_password === '') {
    return { valid: false, message: 'current_password is required' };
  }

  if (typeof new_password !== 'string' || new_password === '') {
    return { valid: false, message: 'new_password is required' };
  }

  return { valid: true, currentPassword: current_password, newPassword: new_password };
}

export const MEMO_MIN_LENGTH = 1;
export const MEMO_MAX_LENGTH = 5000;

export type MemoBodyResult =
  | { valid: true; content: string }
  | { valid: false; code: 'VALIDATION_ERROR' | 'MEMO_TOO_LONG'; message: string };

// Length is counted in characters (code points), the same unit the database CHECK uses.
export function parseMemoBody(body: unknown): MemoBodyResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object' };
  }

  const { content } = body as Record<string, unknown>;

  if (typeof content !== 'string') {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'content is required and must be a string' };
  }

  const trimmed = content.trim();
  const length = Array.from(trimmed).length;

  if (length < MEMO_MIN_LENGTH) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'content must not be empty' };
  }

  if (length > MEMO_MAX_LENGTH) {
    return {
      valid: false,
      code: 'MEMO_TOO_LONG',
      message: `content must be at most ${MEMO_MAX_LENGTH} characters`
    };
  }

  if (REASON_FORBIDDEN_CHARS.test(trimmed)) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'content contains invalid control characters' };
  }

  return { valid: true, content: trimmed };
}
