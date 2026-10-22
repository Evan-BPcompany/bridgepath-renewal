import { getPool } from '../config/database';
import { config } from '../config/env';
import { PricedQuoteItem, QuoteInput, missingContact, priceItems, todayInKorea } from '../utils/detailedQuote';
import { buildQuotePublishedEmail, quoteLink } from '../utils/quoteEmail';
import { queueEmailInTransaction } from './emailService';

export type QuoteErrorCode =
  | 'ESTIMATE_NOT_FOUND'
  | 'NO_CUSTOMER_ACCOUNT'
  | 'QUOTE_CONFLICT'
  | 'NO_QUOTE'
  | 'QUOTE_INCOMPLETE'
  | 'NOTHING_TO_PUBLISH';

export class QuoteError extends Error {
  constructor(public readonly code: QuoteErrorCode) {
    super(code);
    this.name = 'QuoteError';
  }
}

export interface WorkingQuote {
  id: string;
  items: PricedQuoteItem[];
  total_amount: number;
  currency: 'KRW';
  fx_currency: string | null;
  fx_rate: number | null;
  valid_until: string | null;
  lead_time: string | null;
  customer_note: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  // The number of the last publication (0: never published), the save this copy is, and whether it
  // has been changed since it was published.
  version: number;
  edit_seq: number;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  updated_by: { id: string; username: string } | null;
}

export interface QuoteRevision {
  version: number;
  published_at: string;
  published_by: { id: string; username: string } | null;
}

export interface QuoteContext {
  estimate_id: string;
  // A quote can only be written for a request of a customer with an account: it is shown there.
  has_account: boolean;
  quote: WorkingQuote | null;
  revisions: QuoteRevision[];
}

type Row = Record<string, any>;

const iso = (value: unknown): string => new Date(value as string | number | Date).toISOString();

const QUOTE_COLUMNS = `q.id, q.items, q.total_amount, q.fx_currency, q.fx_rate,
  to_char(q.valid_until, 'YYYY-MM-DD') AS valid_until, q.lead_time, q.customer_note,
  q.contact_name, q.contact_email, q.contact_phone, q.version, q.edit_seq,
  q.has_unpublished_changes, q.created_at, q.updated_at, q.published_at, q.updated_by,
  u.username AS updated_by_username`;

function toWorkingQuote(row: Row): WorkingQuote {
  return {
    id: row.id,
    items: row.items,
    total_amount: Number(row.total_amount),
    currency: 'KRW',
    fx_currency: row.fx_currency ?? null,
    fx_rate: row.fx_rate === null || row.fx_rate === undefined ? null : Number(row.fx_rate),
    valid_until: row.valid_until ?? null,
    lead_time: row.lead_time ?? null,
    customer_note: row.customer_note ?? null,
    contact_name: row.contact_name ?? null,
    contact_email: row.contact_email ?? null,
    contact_phone: row.contact_phone ?? null,
    version: row.version,
    edit_seq: row.edit_seq,
    has_unpublished_changes: row.has_unpublished_changes === true,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    published_at: row.published_at ? iso(row.published_at) : null,
    updated_by: row.updated_by ? { id: row.updated_by, username: row.updated_by_username } : null
  };
}

async function loadWorkingQuote(estimateId: string): Promise<WorkingQuote | null> {
  const result = await getPool().query(
    `SELECT ${QUOTE_COLUMNS}
     FROM detailed_quotes q LEFT JOIN admin_users u ON u.id = q.updated_by
     WHERE q.estimate_id = $1`,
    [estimateId]
  );
  return result.rows[0] ? toWorkingQuote(result.rows[0]) : null;
}

export async function getQuoteContext(estimateId: string): Promise<QuoteContext | null> {
  const pool = getPool();
  const estimate = await pool.query(`SELECT id, customer_id IS NOT NULL AS has_account FROM estimates WHERE id = $1`, [estimateId]);
  if (estimate.rows.length === 0) {
    return null;
  }

  const quote = await loadWorkingQuote(estimateId);
  const revisions = quote
    ? await pool.query(
        `SELECT r.version, r.published_at, r.published_by, u.username
         FROM detailed_quote_revisions r
         JOIN detailed_quotes q ON q.id = r.quote_id
         LEFT JOIN admin_users u ON u.id = r.published_by
         WHERE q.estimate_id = $1 ORDER BY r.version DESC`,
        [estimateId]
      )
    : { rows: [] as Row[] };

  return {
    estimate_id: estimateId,
    has_account: estimate.rows[0].has_account === true,
    quote,
    revisions: revisions.rows.map((row: Row) => ({
      version: row.version,
      published_at: iso(row.published_at),
      published_by: row.published_by ? { id: row.published_by, username: row.username } : null
    }))
  };
}

// What the contact fields of a new quote start with, so a staff member does not type the same thing
// every time: the name and phone of their latest quote, and their own e-mail.
export async function getContactDefaults(
  admin: { id: string; username: string; email: string }
): Promise<{ name: string; email: string; phone: string | null }> {
  const last = await getPool().query(
    `SELECT contact_name, contact_phone FROM detailed_quotes
     WHERE updated_by = $1 AND contact_phone IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
    [admin.id]
  );
  return {
    name: last.rows[0]?.contact_name ?? admin.username,
    email: admin.email,
    phone: last.rows[0]?.contact_phone ?? null
  };
}

// Saves the working copy. The first save creates it (no expected_edit_seq); every later save has to
// name the save it was made from, so a change by a colleague is noticed instead of overwritten.
// The amounts and the total are counted here, from the quantities and unit prices.
export async function saveQuote(estimateId: string, adminId: string, input: QuoteInput): Promise<WorkingQuote> {
  const pool = getPool();

  const estimate = await pool.query(`SELECT customer_id FROM estimates WHERE id = $1`, [estimateId]);
  if (estimate.rows.length === 0) {
    throw new QuoteError('ESTIMATE_NOT_FOUND');
  }
  if (!estimate.rows[0].customer_id) {
    throw new QuoteError('NO_CUSTOMER_ACCOUNT');
  }

  const priced = priceItems(input.items);
  const values = [
    JSON.stringify(priced.items),
    priced.total,
    input.fx_currency,
    input.fx_rate,
    input.valid_until,
    input.lead_time,
    input.customer_note,
    input.contact_name,
    input.contact_email,
    input.contact_phone
  ];

  let saved;
  if (input.expected_edit_seq === null) {
    saved = await pool.query(
      `INSERT INTO detailed_quotes (estimate_id, items, total_amount, fx_currency, fx_rate, valid_until, lead_time,
                                    customer_note, contact_name, contact_email, contact_phone, created_by, updated_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       ON CONFLICT (estimate_id) DO NOTHING
       RETURNING id`,
      [estimateId, ...values, adminId]
    );
  } else {
    saved = await pool.query(
      `UPDATE detailed_quotes
       SET items = $2::jsonb, total_amount = $3, fx_currency = $4, fx_rate = $5, valid_until = $6, lead_time = $7,
           customer_note = $8, contact_name = $9, contact_email = $10, contact_phone = $11, updated_by = $12,
           edit_seq = edit_seq + 1, has_unpublished_changes = true, updated_at = CURRENT_TIMESTAMP
       WHERE estimate_id = $1 AND edit_seq = $13
       RETURNING id`,
      [estimateId, ...values, adminId, input.expected_edit_seq]
    );
  }
  if (saved.rows.length === 0) {
    throw new QuoteError('QUOTE_CONFLICT');
  }

  const quote = await loadWorkingQuote(estimateId);
  if (!quote) {
    throw new QuoteError('QUOTE_CONFLICT');
  }
  return quote;
}

// Publishes the working copy: a new revision is written as it is now, and from that moment the
// customer sees it. The row is locked, so a save that comes in at the same time either lands before
// (and is published, if it was the save the publisher saw) or is refused as a conflict.
export interface PublishResult {
  quote: WorkingQuote;
  // The e-mail that tells the customer was queued (false when the request has no active account any more).
  notification_queued: boolean;
}

export async function publishQuote(estimateId: string, adminId: string, expectedEditSeq: number): Promise<PublishResult> {
  const pool = getPool();
  const client = await pool.connect();
  let notificationQueued = false;

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, items, total_amount, fx_currency, fx_rate, to_char(valid_until, 'YYYY-MM-DD') AS valid_until,
              lead_time, customer_note, contact_name, contact_email, contact_phone, version, edit_seq, has_unpublished_changes
       FROM detailed_quotes WHERE estimate_id = $1 FOR UPDATE`,
      [estimateId]
    );
    const row = found.rows[0];

    if (!row) {
      throw new QuoteError('NO_QUOTE');
    }
    if (row.edit_seq !== expectedEditSeq) {
      throw new QuoteError('QUOTE_CONFLICT');
    }
    if (row.has_unpublished_changes !== true) {
      throw new QuoteError('NOTHING_TO_PUBLISH');
    }
    // A copy that was saved earlier may have become unfit since: its validity date may have passed.
    if (
      !Array.isArray(row.items) ||
      row.items.length === 0 ||
      Number(row.total_amount) <= 0 ||
      missingContact(row).length > 0 ||
      (row.valid_until && row.valid_until < todayInKorea())
    ) {
      throw new QuoteError('QUOTE_INCOMPLETE');
    }

    const version = row.version + 1;
    const snapshot = {
      items: row.items,
      total_amount: Number(row.total_amount),
      currency: 'KRW',
      fx_currency: row.fx_currency ?? null,
      fx_rate: row.fx_rate === null ? null : Number(row.fx_rate),
      valid_until: row.valid_until ?? null,
      lead_time: row.lead_time ?? null,
      customer_note: row.customer_note ?? null,
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone
    };

    await client.query(
      `INSERT INTO detailed_quote_revisions (quote_id, version, snapshot, published_by) VALUES ($1, $2, $3::jsonb, $4)`,
      [row.id, version, JSON.stringify(snapshot), adminId]
    );
    await client.query(
      `UPDATE detailed_quotes
       SET version = $2, has_unpublished_changes = false, published_at = CURRENT_TIMESTAMP, updated_by = $3
       WHERE id = $1`,
      [row.id, version, adminId]
    );

    // The customer is told in the same transaction: either the revision and the mail are both
    // there, or neither is (the outbox sends it later and retries). The mail has no amount in it.
    const customer = await client.query(
      `SELECT e.receipt_id, c.email
       FROM estimates e JOIN customers c ON c.id = e.customer_id
       WHERE e.id = $1 AND c.is_active = true`,
      [estimateId]
    );
    if (customer.rows[0]) {
      const mail = buildQuotePublishedEmail({
        receiptId: customer.rows[0].receipt_id,
        version,
        link: quoteLink(config.frontendBaseUrl, customer.rows[0].receipt_id),
        supportEmail: config.supportEmail
      });
      await queueEmailInTransaction(client, {
        recipient_email: customer.rows[0].email,
        email_type: 'quotation',
        estimate_id: estimateId,
        idempotency_key: `quote-published-${row.id}-v${version}`,
        subject: mail.subject,
        body: mail.body
      });
      notificationQueued = true;
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

  const quote = await loadWorkingQuote(estimateId);
  if (!quote) {
    throw new QuoteError('NO_QUOTE');
  }
  return { quote, notification_queued: notificationQueued };
}
