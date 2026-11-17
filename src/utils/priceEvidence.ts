// Checks and stores price evidence (table price_evidence, migration 023). A file of rows comes in, only the rows that the owner
// marked "approved" and that pass every check go to the table; nothing else is stored, and nothing is guessed or filled in.

export const EVIDENCE_REGIONS = ['overseas', 'domestic'] as const;
export const EVIDENCE_PRICE_KINDS = ['listing', 'quote', 'retail'] as const;
export const EVIDENCE_CURRENCIES = ['USD', 'KRW', 'CNY'] as const;
export const EVIDENCE_SUPPLIER_TYPES = ['factory', 'trading', 'unknown'] as const;
export const EVIDENCE_STATUSES = ['candidate', 'approved', 'rejected'] as const;

// A listing whose top price is more than this many times its bottom price is not a price (the sample listings ran from 2.5 to 79).
export const MAX_LISTING_SPREAD = 1.35;

export interface EvidenceRow {
  category: string;
  product_type: string;
  region: (typeof EVIDENCE_REGIONS)[number];
  price_kind: (typeof EVIDENCE_PRICE_KINDS)[number];
  price_min: number;
  price_max: number;
  currency: (typeof EVIDENCE_CURRENCIES)[number];
  unit: string;
  moq: number | null;
  trade_terms: string | null;
  upper_material: string | null;
  outsole: string | null;
  closure: string | null;
  supplier_name: string | null;
  supplier_type: (typeof EVIDENCE_SUPPLIER_TYPES)[number];
  source_url: string | null;
  source_title: string;
  price_date: string | null;
  collected_at: string;
  status: (typeof EVIDENCE_STATUSES)[number];
  note: string | null;
}

const KEYS = [
  'category', 'product_type', 'region', 'price_kind', 'price_min', 'price_max', 'currency', 'unit', 'moq', 'trade_terms',
  'upper_material', 'outsole', 'closure', 'supplier_name', 'supplier_type', 'source_url', 'source_title', 'price_date',
  'collected_at', 'status', 'note'
] as const;

type Raw = Record<string, unknown>;

const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
};

export function validateEvidence(input: unknown): { row?: EvidenceRow; errors: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { errors: ['a row must be an object'] };
  }
  const raw = input as Raw;
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown field "${key}"`);
    }
  }

  const text = (key: string, max: number, required: boolean): string | null => {
    const value = raw[key];
    if (value === undefined || value === null || value === '') {
      if (required) {
        errors.push(`${key} is required`);
      }
      return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key} must be text`);
      return null;
    }
    if (value.trim().length > max) {
      errors.push(`${key} is longer than ${max} characters`);
      return null;
    }
    return value.trim();
  };
  const choice = <T extends string>(key: string, allowed: readonly T[], fallback?: T): T => {
    const value = raw[key] === undefined || raw[key] === null || raw[key] === '' ? fallback : raw[key];
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      errors.push(`${key} must be one of ${allowed.join(', ')}`);
      return (fallback ?? allowed[0]) as T;
    }
    return value as T;
  };
  const price = (key: string): number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`${key} must be a number above 0`);
      return 0;
    }
    return value;
  };

  const category = text('category', 40, true);
  const productType = text('product_type', 40, true);
  const region = choice('region', EVIDENCE_REGIONS);
  const priceKind = choice('price_kind', EVIDENCE_PRICE_KINDS);
  const priceMin = price('price_min');
  const priceMax = price('price_max');
  const currency = choice('currency', EVIDENCE_CURRENCIES);
  const unit = text('unit', 20, false) ?? 'pair';
  const supplierType = choice('supplier_type', EVIDENCE_SUPPLIER_TYPES, 'unknown');
  const status = choice('status', EVIDENCE_STATUSES);
  const sourceTitle = text('source_title', 300, true);
  const sourceUrl = text('source_url', 2000, false);

  let moq: number | null = null;
  if (raw.moq !== undefined && raw.moq !== null) {
    if (typeof raw.moq !== 'number' || !Number.isInteger(raw.moq) || raw.moq <= 0) {
      errors.push('moq must be a whole number above 0');
    } else {
      moq = raw.moq;
    }
  }

  if (priceMin > 0 && priceMax > 0 && priceMax < priceMin) {
    errors.push('price_max is below price_min');
  }
  if (priceKind === 'listing' && priceMin > 0 && priceMax / priceMin > MAX_LISTING_SPREAD) {
    errors.push(`a listing price range wider than ${MAX_LISTING_SPREAD} times is not a price`);
  }

  if (sourceUrl !== null) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('source_url must start with http:// or https://');
      }
    } catch {
      errors.push('source_url is not a web address');
    }
  } else if (priceKind !== 'quote') {
    errors.push('source_url is required unless the row is a real quote');
  }

  const collectedAt = raw.collected_at;
  if (!isDate(collectedAt)) {
    errors.push('collected_at must be a date like 2026-11-17');
  }
  const priceDate = raw.price_date === undefined || raw.price_date === null || raw.price_date === '' ? null : raw.price_date;
  if (priceDate !== null && !isDate(priceDate)) {
    errors.push('price_date must be a date like 2026-11-17');
  }

  if (errors.length > 0) {
    return { errors };
  }
  return {
    errors,
    row: {
      category: category as string,
      product_type: productType as string,
      region,
      price_kind: priceKind,
      price_min: priceMin,
      price_max: priceMax,
      currency,
      unit,
      moq,
      trade_terms: text('trade_terms', 20, false),
      upper_material: text('upper_material', 40, false),
      outsole: text('outsole', 40, false),
      closure: text('closure', 40, false),
      supplier_name: text('supplier_name', 200, false),
      supplier_type: supplierType,
      source_url: sourceUrl,
      source_title: sourceTitle as string,
      price_date: priceDate as string | null,
      collected_at: collectedAt as string,
      status,
      note: text('note', 500, false)
    }
  };
}

export interface EvidenceFileResult {
  approved: EvidenceRow[];
  skipped: number; // valid rows that are not "approved" (candidates and rejected rows)
  problems: string[]; // one line per invalid row, with its number in the file
}

// A file is a JSON array of rows. A row that is not valid is reported and never stored, whatever its status.
export function parseEvidenceFile(text: string): EvidenceFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { approved: [], skipped: 0, problems: ['the file is not valid JSON'] };
  }
  if (!Array.isArray(data)) {
    return { approved: [], skipped: 0, problems: ['the file must be a JSON array of rows'] };
  }
  const result: EvidenceFileResult = { approved: [], skipped: 0, problems: [] };
  data.forEach((item, index) => {
    const { row, errors } = validateEvidence(item);
    if (!row) {
      result.problems.push(`row ${index + 1}: ${errors.join('; ')}`);
    } else if (row.status === 'approved') {
      result.approved.push(row);
    } else {
      result.skipped += 1;
    }
  });
  return result;
}

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
}

const COLUMNS = [
  'category', 'product_type', 'region', 'price_kind', 'price_min', 'price_max', 'currency', 'unit', 'moq', 'trade_terms',
  'upper_material', 'outsole', 'closure', 'supplier_name', 'supplier_type', 'source_url', 'source_title', 'price_date',
  'collected_at', 'note'
] as const;

// Stores approved rows. A row that is already there (the same kind, source, title and collection date) is left as it is.
export async function storeEvidence(db: Queryable, rows: EvidenceRow[]): Promise<{ stored: number; duplicates: number }> {
  const sql =
    `INSERT INTO price_evidence (${COLUMNS.join(', ')}, status, approved_at) ` +
    `VALUES (${COLUMNS.map((_, index) => `$${index + 1}`).join(', ')}, 'approved', CURRENT_TIMESTAMP) ` +
    `ON CONFLICT (price_kind, (COALESCE(source_url, '')), source_title, collected_at) DO NOTHING`;
  let stored = 0;
  for (const row of rows) {
    const result = await db.query(sql, COLUMNS.map(column => row[column]));
    stored += result.rowCount ?? 0;
  }
  return { stored, duplicates: rows.length - stored };
}
