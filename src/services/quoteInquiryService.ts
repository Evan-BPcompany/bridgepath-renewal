import { getPool } from '../config/database';
import { config } from '../config/env';
import { INQUIRY_LIMITS, InquiryInput } from '../utils/quoteInquiry';
import { buildAdminInquiryEmail, buildInquiryAnsweredEmail, quoteLink } from '../utils/quoteEmail';
import { queueEmailInTransaction } from './emailService';

export type InquiryErrorCode =
  | 'ESTIMATE_NOT_FOUND'
  | 'NO_QUOTE'
  | 'ALREADY_OPEN'
  | 'TOO_MANY'
  | 'INQUIRY_NOT_FOUND'
  | 'WRONG_KIND'
  | 'ALREADY_HANDLED';

export class InquiryError extends Error {
  constructor(public readonly code: InquiryErrorCode) {
    super(code);
    this.name = 'InquiryError';
  }
}

type Row = Record<string, any>;
const iso = (value: unknown): string => new Date(value as string | number | Date).toISOString();

// What the customer sees of their own inquiries: never who handled them.
export interface OwnInquiry {
  id: string;
  kind: 'question' | 'consultation';
  quote_version: number;
  body: string | null;
  phone: string | null;
  preferred_time: string | null;
  status: 'open' | 'answered' | 'done';
  answer: string | null;
  created_at: string;
  handled_at: string | null;
}

export function toOwnInquiry(row: Row): OwnInquiry {
  return {
    id: row.id,
    kind: row.kind,
    quote_version: row.quote_version,
    body: row.body ?? null,
    phone: row.phone ?? null,
    preferred_time: row.preferred_time ?? null,
    status: row.status,
    answer: row.answer ?? null,
    created_at: iso(row.created_at),
    handled_at: row.handled_at ? iso(row.handled_at) : null
  };
}

export async function listOwnInquiries(customerId: string, estimateId: string): Promise<OwnInquiry[]> {
  const result = await getPool().query(
    `SELECT id, kind, quote_version, body, phone, preferred_time, status, answer, created_at, handled_at
     FROM quote_inquiries WHERE estimate_id = $1 AND customer_id = $2
     ORDER BY created_at ASC, id ASC`,
    [estimateId, customerId]
  );
  return result.rows.map(toOwnInquiry);
}

// ---------------------------------------------------------------------------------------------
// The customer asks

// A question or a request for a consultation about the quote that the staff published. The request
// has to be the customer's own and have a published quote. One open question and one open
// consultation at a time, and at most 20 inquiries on a request. The staff are told by e-mail (the
// mail has no text of the customer's) in the same transaction.
export async function createInquiry(customerId: string, receiptId: string, input: InquiryInput): Promise<OwnInquiry> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const estimate = await client.query(
      `SELECT e.id, q.version
       FROM estimates e LEFT JOIN detailed_quotes q ON q.estimate_id = e.id
       WHERE e.receipt_id = $1 AND e.customer_id = $2
       FOR UPDATE OF e`,
      [receiptId, customerId]
    );
    const found = estimate.rows[0];
    if (!found) {
      throw new InquiryError('ESTIMATE_NOT_FOUND');
    }
    if (!found.version || found.version < 1) {
      throw new InquiryError('NO_QUOTE');
    }

    // The request row is locked above, so two parallel inquiries on it are counted one after the other.
    const count = await client.query(`SELECT COUNT(*)::int AS total FROM quote_inquiries WHERE estimate_id = $1`, [found.id]);
    if (count.rows[0].total >= INQUIRY_LIMITS.perEstimate) {
      throw new InquiryError('TOO_MANY');
    }

    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO quote_inquiries (estimate_id, customer_id, quote_version, kind, body, phone, preferred_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, kind, quote_version, body, phone, preferred_time, status, answer, created_at, handled_at`,
        [
          found.id,
          customerId,
          found.version,
          input.kind,
          input.body,
          input.kind === 'consultation' ? input.phone : null,
          input.kind === 'consultation' ? input.preferred_time : null
        ]
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new InquiryError('ALREADY_OPEN');
      }
      throw err;
    }

    if (config.adminNotificationEmail) {
      const mail = buildAdminInquiryEmail({ receiptId, kind: input.kind });
      await queueEmailInTransaction(client, {
        recipient_email: config.adminNotificationEmail,
        email_type: 'admin_notification',
        estimate_id: found.id,
        idempotency_key: `inquiry-${inserted.rows[0].id}`,
        subject: mail.subject,
        body: mail.body
      });
    }

    await client.query('COMMIT');
    return toOwnInquiry(inserted.rows[0]);
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

// ---------------------------------------------------------------------------------------------
// The staff

export interface AdminInquiry {
  id: string;
  kind: 'question' | 'consultation';
  quote_version: number;
  body: string | null;
  // The number to phone (consultation) and when it suits the customer.
  phone: string | null;
  preferred_time: string | null;
  status: 'open' | 'answered' | 'done';
  answer: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: { id: string; username: string } | null;
}

function toAdminInquiry(row: Row): AdminInquiry {
  return {
    ...toOwnInquiry(row),
    handled_by: row.handled_by ? { id: row.handled_by, username: row.handled_by_username } : null
  };
}

const ADMIN_COLUMNS = `i.id, i.kind, i.quote_version, i.body, i.phone, i.preferred_time, i.status, i.answer, i.created_at,
  i.handled_at, i.handled_by, u.username AS handled_by_username`;

// Open ones first (oldest first, the one waiting longest on top), then the handled ones, newest first.
export async function listInquiries(estimateId: string): Promise<AdminInquiry[] | null> {
  const pool = getPool();
  const estimate = await pool.query(`SELECT 1 FROM estimates WHERE id = $1`, [estimateId]);
  if (estimate.rows.length === 0) {
    return null;
  }
  const result = await pool.query(
    `SELECT ${ADMIN_COLUMNS}
     FROM quote_inquiries i LEFT JOIN admin_users u ON u.id = i.handled_by
     WHERE i.estimate_id = $1
     ORDER BY (i.status = 'open') DESC,
              CASE WHEN i.status = 'open' THEN i.created_at END ASC,
              i.created_at DESC, i.id DESC`,
    [estimateId]
  );
  return result.rows.map(toAdminInquiry);
}

// Closes an open inquiry in one statement, so two staff members cannot both handle it. Says why when it
// cannot: no such inquiry, the other kind, or already handled.
async function close(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Row[] }> },
  estimateId: string,
  inquiryId: string,
  kind: 'question' | 'consultation',
  adminId: string,
  answer: string | null
): Promise<Row> {
  const updated = await client.query(
    `UPDATE quote_inquiries
     SET status = $4, answer = $5, handled_by = $6, handled_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND estimate_id = $2 AND kind = $3 AND status = 'open'
     RETURNING id, customer_id`,
    [inquiryId, estimateId, kind, kind === 'question' ? 'answered' : 'done', answer, adminId]
  );
  if (updated.rows[0]) {
    return updated.rows[0];
  }
  const existing = await client.query(`SELECT kind, status FROM quote_inquiries WHERE id = $1 AND estimate_id = $2`, [inquiryId, estimateId]);
  if (existing.rows.length === 0) {
    throw new InquiryError('INQUIRY_NOT_FOUND');
  }
  throw new InquiryError(existing.rows[0].kind !== kind ? 'WRONG_KIND' : 'ALREADY_HANDLED');
}

// Answers a question; the customer is told by e-mail (a link, not the answer), in the same transaction.
export async function answerQuestion(estimateId: string, inquiryId: string, adminId: string, answer: string): Promise<AdminInquiry> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const closed = await close(client, estimateId, inquiryId, 'question', adminId, answer);

    const customer = await client.query(
      `SELECT e.receipt_id, c.email
       FROM estimates e JOIN customers c ON c.id = $2
       WHERE e.id = $1 AND c.is_active = true`,
      [estimateId, closed.customer_id]
    );
    if (closed.customer_id && customer.rows[0]) {
      const mail = buildInquiryAnsweredEmail({
        receiptId: customer.rows[0].receipt_id,
        link: quoteLink(config.frontendBaseUrl, customer.rows[0].receipt_id),
        supportEmail: config.supportEmail
      });
      await queueEmailInTransaction(client, {
        recipient_email: customer.rows[0].email,
        email_type: 'status_update',
        estimate_id: estimateId,
        idempotency_key: `inquiry-answer-${inquiryId}`,
        subject: mail.subject,
        body: mail.body
      });
    }

    await client.query('COMMIT');
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

  const list = await listInquiries(estimateId);
  const done = list?.find(item => item.id === inquiryId);
  if (!done) {
    throw new InquiryError('INQUIRY_NOT_FOUND');
  }
  return done;
}

// The staff phoned the customer: the consultation is done, with a short note if they like.
export async function completeConsultation(estimateId: string, inquiryId: string, adminId: string, note: string | null): Promise<AdminInquiry> {
  await close(getPool(), estimateId, inquiryId, 'consultation', adminId, note);
  const list = await listInquiries(estimateId);
  const done = list?.find(item => item.id === inquiryId);
  if (!done) {
    throw new InquiryError('INQUIRY_NOT_FOUND');
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// The inbox: what the customers asked, over all requests

export interface InboxItem extends AdminInquiry {
  estimate: { id: string; receipt_id: string; category: string; customer_name: string | null; company_name: string | null };
}

export interface InboxResult {
  items: InboxItem[];
  total: number;
  // What waits for the staff, whatever the filter: the questions to answer and the calls to make.
  counts: { open_questions: number; open_consultations: number };
}

// Open ones first and the longest waiting on top (the staff work through them in that order); the handled
// ones newest first. The customer's name and company are the ones typed on the request, to find it.
export async function listInbox(query: { status: 'open' | 'handled' | 'all'; kind?: 'question' | 'consultation'; page: number; limit: number }): Promise<InboxResult> {
  const pool = getPool();
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.status === 'open') {
    where.push(`i.status = 'open'`);
  } else if (query.status === 'handled') {
    where.push(`i.status <> 'open'`);
  }
  if (query.kind) {
    params.push(query.kind);
    where.push(`i.kind = $${params.length}`);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (query.page - 1) * query.limit;

  const [count, list, counts] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM quote_inquiries i ${clause}`, params),
    pool.query(
      `SELECT ${ADMIN_COLUMNS}, e.id AS estimate_id, e.receipt_id, e.category, e.customer_name, e.company_name
       FROM quote_inquiries i
       JOIN estimates e ON e.id = i.estimate_id
       LEFT JOIN admin_users u ON u.id = i.handled_by
       ${clause}
       ORDER BY (i.status = 'open') DESC,
                CASE WHEN i.status = 'open' THEN i.created_at END ASC,
                i.handled_at DESC NULLS LAST, i.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE kind = 'question')::int AS open_questions,
              COUNT(*) FILTER (WHERE kind = 'consultation')::int AS open_consultations
       FROM quote_inquiries WHERE status = 'open'`
    )
  ]);

  return {
    total: count.rows[0].total,
    counts: { open_questions: counts.rows[0].open_questions, open_consultations: counts.rows[0].open_consultations },
    items: list.rows.map((row: Row) => ({
      ...toAdminInquiry(row),
      estimate: {
        id: row.estimate_id,
        receipt_id: row.receipt_id,
        category: row.category,
        customer_name: row.customer_name ?? null,
        company_name: row.company_name ?? null
      }
    }))
  };
}
