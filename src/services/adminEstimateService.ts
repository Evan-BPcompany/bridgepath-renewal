import { getPool } from '../config/database';
import { FILE_METADATA_COLUMNS, FileMetadata, toFileMetadata } from './adminFileService';
import { ListQuery, SortField } from '../middleware/adminValidation';
import {
  AdminRole,
  EstimateStatus,
  STATUS_ERRORS,
  checkTransition,
  isEstimateStatus,
  isRetiredStatus
} from '../utils/statusTransitions';

const SORT_COLUMNS: Record<SortField, string> = {
  created_at: 'e.created_at',
  updated_at: 'e.updated_at',
  status: 'e.status',
  receipt_id: 'e.receipt_id'
};

const DETAIL_HISTORY_LIMIT = 200;
const DETAIL_MEMO_LIMIT = 100;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

export function buildListWhere(query: ListQuery): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.statuses.length > 0) {
    conditions.push(`e.status = ANY(${add(query.statuses)}::text[])`);
  }

  if (query.category) {
    conditions.push(`e.category = ${add(query.category)}`);
  }

  if (query.createdFrom) {
    conditions.push(`e.created_at >= (${add(query.createdFrom)}::date)::timestamp AT TIME ZONE 'Asia/Seoul'`);
  }

  if (query.createdTo) {
    conditions.push(`e.created_at < ((${add(query.createdTo)}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')`);
  }

  if (query.search) {
    const escaped = escapeLike(query.search);
    const prefix = add(`${escaped}%`);
    const contains = add(`%${escaped}%`);

    const searchParts = [
      `e.receipt_id ILIKE ${prefix}`,
      `e.company_name ILIKE ${contains}`,
      `e.customer_name ILIKE ${contains}`,
      `e.customer_email ILIKE ${contains}`
    ];

    const digits = query.search.replace(/\D/g, '');
    if (/^[0-9+\-()\s]+$/.test(query.search) && digits.length >= 4) {
      const phone = add(`%${digits}%`);
      searchParts.push(`regexp_replace(coalesce(e.customer_phone, ''), '\\D', '', 'g') LIKE ${phone}`);
    }

    conditions.push(`(${searchParts.join(' OR ')})`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

export interface EstimateListItem {
  id: string;
  receipt_id: string;
  category: string;
  status: string;
  company_name: string | null;
  customer_name: string | null;
  // 'individual_startup' | 'business_brand'; null for requests received before migration 012.
  customer_type: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
}

export async function listEstimates(
  query: ListQuery
): Promise<{ items: EstimateListItem[]; total: number }> {
  const pool = getPool();
  const { clause, params } = buildListWhere(query);

  const sortColumn = SORT_COLUMNS[query.sort];
  const direction = query.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (query.page - 1) * query.limit;

  const countSql = `SELECT COUNT(*)::int AS total FROM estimates e ${clause}`;
  const listSql = `
    SELECT e.id, e.receipt_id, e.category, e.status, e.company_name, e.customer_name,
           e.customer_type, e.created_at, e.updated_at,
           (SELECT COUNT(*)::int FROM files f WHERE f.estimate_id = e.id) AS file_count
    FROM estimates e
    ${clause}
    ORDER BY ${sortColumn} ${direction}, e.id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [countResult, listResult] = await Promise.all([
    pool.query(countSql, params),
    pool.query(listSql, [...params, query.limit, offset])
  ]);

  return {
    total: countResult.rows[0].total,
    items: listResult.rows.map(row => ({
      id: row.id,
      receipt_id: row.receipt_id,
      category: row.category,
      status: row.status,
      company_name: row.company_name,
      customer_name: row.customer_name,
      customer_type: row.customer_type ?? null,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
      file_count: row.file_count
    }))
  };
}

export interface EstimateDetail {
  estimate: {
    id: string;
    receipt_id: string;
    category: string;
    status: string;
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
    company_name: string | null;
    // Customer type and privacy consent (PRD FR-4.2, FR-5.3): all three are null for requests
    // received before migration 012, which have no consent record.
    customer_type: string | null;
    privacy_consent_at: string | null;
    privacy_consent_version: string | null;
    specification_json: unknown;
    is_consultation: boolean;
    created_at: string;
    updated_at: string;
  };
  files: FileMetadata[];
  status_history: Array<{
    id: string;
    old_status: string | null;
    new_status: string;
    changed_by: { id: string; username: string } | null;
    reason: string | null;
    created_at: string;
    // true when old_status or new_status is one of the statuses retired by migration 013
    // (rejected, archived, negotiating). The stored values are returned as they were written.
    retired_status: boolean;
  }>;
  memos: Array<{
    id: string;
    content: string;
    author: { id: string; username: string };
    created_at: string;
  }>;
}

// Never selects s3_key, virus_scan_result, access tokens or token hashes.
export async function getEstimateDetail(id: string): Promise<EstimateDetail | null> {
  const pool = getPool();

  const estimateResult = await pool.query(
    `SELECT id, receipt_id, category, status, customer_name, customer_email, customer_phone,
            company_name, customer_type, privacy_consent_at, privacy_consent_version,
            specification_json, is_consultation, created_at, updated_at
     FROM estimates WHERE id = $1`,
    [id]
  );

  if (estimateResult.rows.length === 0) {
    return null;
  }

  const [filesResult, historyResult, memosResult] = await Promise.all([
    pool.query(
      `SELECT ${FILE_METADATA_COLUMNS}
       FROM files WHERE estimate_id = $1 ORDER BY uploaded_at ASC, id ASC`,
      [id]
    ),
    pool.query(
      `SELECT h.id, h.old_status, h.new_status, h.reason, h.created_at,
              h.changed_by, u.username AS changed_by_username
       FROM status_history h
       LEFT JOIN admin_users u ON u.id = h.changed_by
       WHERE h.estimate_id = $1
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT $2`,
      [id, DETAIL_HISTORY_LIMIT]
    ),
    pool.query(
      `SELECT m.id, m.content, m.created_at, m.admin_user_id, u.username AS author_username
       FROM admin_memos m
       JOIN admin_users u ON u.id = m.admin_user_id
       WHERE m.estimate_id = $1
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $2`,
      [id, DETAIL_MEMO_LIMIT]
    )
  ]);

  const e = estimateResult.rows[0];

  return {
    estimate: {
      id: e.id,
      receipt_id: e.receipt_id,
      category: e.category,
      status: e.status,
      customer_name: e.customer_name,
      customer_email: e.customer_email,
      customer_phone: e.customer_phone,
      company_name: e.company_name,
      customer_type: e.customer_type ?? null,
      privacy_consent_at: e.privacy_consent_at ? iso(e.privacy_consent_at) : null,
      privacy_consent_version: e.privacy_consent_version ?? null,
      specification_json: e.specification_json,
      is_consultation: e.is_consultation,
      created_at: iso(e.created_at),
      updated_at: iso(e.updated_at)
    },
    files: filesResult.rows.map(toFileMetadata),
    status_history: historyResult.rows.map(h => ({
      id: h.id,
      old_status: h.old_status,
      new_status: h.new_status,
      changed_by: h.changed_by ? { id: h.changed_by, username: h.changed_by_username } : null,
      reason: h.reason,
      created_at: iso(h.created_at),
      retired_status: isRetiredStatus(h.old_status) || isRetiredStatus(h.new_status)
    })),
    memos: memosResult.rows.map(m => ({
      id: m.id,
      content: m.content,
      author: { id: m.admin_user_id, username: m.author_username },
      created_at: iso(m.created_at)
    }))
  };
}

export interface StatusChangeInput {
  estimateId: string;
  toStatus: EstimateStatus;
  reason?: string;
  expectedStatus?: EstimateStatus;
  admin: { id: string; role: AdminRole };
}

export type StatusChangeOutcome =
  | {
      ok: true;
      data: {
        id: string;
        receipt_id: string;
        previous_status: EstimateStatus;
        status: EstimateStatus;
        updated_at: string;
        history_id: string;
      };
    }
  | {
      ok: false;
      error: (typeof STATUS_ERRORS)[keyof typeof STATUS_ERRORS];
      currentStatus?: string;
    };

// The estimate row is locked with FOR UPDATE inside a READ COMMITTED transaction, so two
// concurrent changes on the same estimate are serialized and each one validates against
// the status committed by the other.
export async function changeEstimateStatus(input: StatusChangeInput): Promise<StatusChangeOutcome> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, receipt_id, status FROM estimates WHERE id = $1 FOR UPDATE`,
      [input.estimateId]
    );

    if (locked.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, error: STATUS_ERRORS.ESTIMATE_NOT_FOUND };
    }

    const row = locked.rows[0];
    const currentStatus: string = row.status;

    if (!isEstimateStatus(currentStatus)) {
      await client.query('ROLLBACK');
      throw new Error('Estimate has a status outside the known status set');
    }

    if (input.expectedStatus !== undefined && input.expectedStatus !== currentStatus) {
      await client.query('ROLLBACK');
      return { ok: false, error: STATUS_ERRORS.STATUS_CONFLICT, currentStatus };
    }

    const check = checkTransition(currentStatus, input.toStatus, input.admin.role, input.reason);
    if (!check.ok) {
      await client.query('ROLLBACK');
      return { ok: false, error: check.error, currentStatus };
    }

    const updated = await client.query(
      `UPDATE estimates SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING updated_at`,
      [input.estimateId, input.toStatus]
    );

    const history = await client.query(
      `INSERT INTO status_history (estimate_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.estimateId, currentStatus, input.toStatus, input.admin.id, input.reason ?? null]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      data: {
        id: row.id,
        receipt_id: row.receipt_id,
        previous_status: currentStatus,
        status: input.toStatus,
        updated_at: iso(updated.rows[0].updated_at),
        history_id: history.rows[0].id
      }
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be unusable; the original error is rethrown below.
    }
    throw err;
  } finally {
    client.release();
  }
}
