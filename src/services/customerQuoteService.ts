import { getPool } from '../config/database';
import { todayInKorea } from '../utils/detailedQuote';

// What a signed-in customer may read about their own requests and the detailed quote the staff
// published for them. Never the internal status, the staff's memos, files or who wrote the quote:
// only the fields below, picked one by one.

export interface OwnEstimateListItem {
  receipt_id: string;
  category: string;
  request_kind: string;
  created_at: string;
  // The staff have published a detailed quote for this request.
  has_quote: boolean;
}

export interface PublishedQuote {
  version: number;
  published_at: string;
  currency: 'KRW';
  items: Array<{ name: string; quantity: number; unit_price: number; amount: number }>;
  total_amount: number;
  fx_currency: string | null;
  fx_rate: number | null;
  valid_until: string | null;
  // True once the validity date has passed (in Korea).
  expired: boolean;
  lead_time: string | null;
  customer_note: string | null;
}

export interface OwnEstimateDetail {
  estimate: { receipt_id: string; category: string; request_kind: string; created_at: string; quantity: number | null };
  quote: PublishedQuote | null;
}

type Row = Record<string, any>;
const iso = (value: unknown): string => new Date(value as string | number | Date).toISOString();

export async function listOwnEstimates(customerId: string): Promise<OwnEstimateListItem[]> {
  const result = await getPool().query(
    `SELECT e.receipt_id, e.category, e.request_kind, e.created_at,
            EXISTS (SELECT 1 FROM detailed_quotes q WHERE q.estimate_id = e.id AND q.version > 0) AS has_quote
     FROM estimates e
     WHERE e.customer_id = $1
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 50`,
    [customerId]
  );
  return result.rows.map((row: Row) => ({
    receipt_id: row.receipt_id,
    category: row.category,
    request_kind: row.request_kind,
    created_at: iso(row.created_at),
    has_quote: row.has_quote === true
  }));
}

function toPublishedQuote(row: Row, today: string): PublishedQuote {
  const snapshot = row.snapshot as Row;
  const items = (Array.isArray(snapshot.items) ? snapshot.items : []).map((item: Row) => ({
    name: String(item.name),
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    amount: Number(item.amount)
  }));
  const validUntil: string | null = snapshot.valid_until ?? null;
  return {
    version: row.version,
    published_at: iso(row.published_at),
    currency: 'KRW',
    items,
    total_amount: Number(snapshot.total_amount),
    fx_currency: snapshot.fx_currency ?? null,
    fx_rate: snapshot.fx_rate === null || snapshot.fx_rate === undefined ? null : Number(snapshot.fx_rate),
    valid_until: validUntil,
    expired: validUntil !== null && validUntil < today,
    lead_time: snapshot.lead_time ?? null,
    customer_note: snapshot.customer_note ?? null
  };
}

// The request has to be the customer's own: any other receipt number gives the same "not found" as
// one that does not exist.
export async function getOwnEstimate(customerId: string, receiptId: string, now: Date = new Date()): Promise<OwnEstimateDetail | null> {
  const pool = getPool();
  const found = await pool.query(
    `SELECT e.id, e.receipt_id, e.category, e.request_kind, e.created_at,
            CASE WHEN jsonb_typeof(e.specification_json -> 'quantity') = 'number' THEN (e.specification_json ->> 'quantity')::numeric END AS quantity
     FROM estimates e WHERE e.receipt_id = $1 AND e.customer_id = $2`,
    [receiptId, customerId]
  );
  const estimate = found.rows[0];
  if (!estimate) {
    return null;
  }

  const revision = await pool.query(
    `SELECT r.version, r.snapshot, r.published_at
     FROM detailed_quote_revisions r JOIN detailed_quotes q ON q.id = r.quote_id
     WHERE q.estimate_id = $1 ORDER BY r.version DESC LIMIT 1`,
    [estimate.id]
  );

  return {
    estimate: {
      receipt_id: estimate.receipt_id,
      category: estimate.category,
      request_kind: estimate.request_kind,
      created_at: iso(estimate.created_at),
      quantity: estimate.quantity === null || estimate.quantity === undefined ? null : Number(estimate.quantity)
    },
    quote: revision.rows[0] ? toPublishedQuote(revision.rows[0], todayInKorea(now)) : null
  };
}
