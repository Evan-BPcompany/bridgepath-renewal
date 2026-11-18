import { getPool } from '../config/database';
import { DISPLAY_USD_KRW, HIGH_PERCENTILE, LOW_PERCENTILE, MIN_LISTINGS, MIN_SUPPLIERS, SINGLE_QUOTE_SPREAD } from '../config/priceRangeRules';
import { INSUFFICIENT_REASON, weightedPercentile, withoutOutliers, type EvidenceItem } from './priceRangeService';

// The price range of a golf tee (2026-11-18, the golf shoe way): from the APPROVED rows of price_evidence of the category golf_tee and
// nothing else. A real factory quote of the material comes first; without one, public listings need MIN_LISTINGS rows from
// MIN_SUPPLIERS suppliers, or the answer is "cannot quote". The rows hold the price of 100 tees (unit 100_tees: a tee costs a few cents,
// which two decimals would lose) and the material in product_type (bamboo_tee, wood_tee, plastic_tee). The golf tee margin is added
// (TEE_MARGIN_RATE). No factor of the material is applied: the material picks its own rows.

export const TEE_MATERIALS = ['bamboo', 'wood', 'plastic', 'unknown'] as const;
export type TeeMaterial = (typeof TEE_MATERIALS)[number];

// The margin of the golf tee (the owner, 2026-11-18): the bamboo tee looked cheap, so its price was raised by 10 % on top of the service
// margin of 10 % (1.1 x 1.1 = 1.21). It is the golf tee's own: the golf shoe keeps the service margin (config/serviceMargin.ts).
export const TEE_MARGIN_RATE = 0.21;
const withTeeMargin = (value: number): number => value * (1 + TEE_MARGIN_RATE);

export const TEES_PER_PACKAGE = 50;
// The minimum order of golf tees: 1,000 packages (the minimum of the request form, estimate-api.js, and the size of the real quote).
export const GOLF_TEE_MOQ_PACKAGES = 1000;

const PACKAGES_PER_EVIDENCE_UNIT = 100 / TEES_PER_PACKAGE; // a row prices 100 tees = 2 packages

export interface TeeRegion {
  status: 'ok' | 'insufficient';
  currency: 'USD' | 'KRW';
  // USD for one package of 50 tees (overseas)
  low?: number;
  high?: number;
  unit_krw?: { low: number; high: number };
  total_krw?: { low: number; high: number };
  reason?: string;
  // for the staff only: what the range rests on (stripped from the public answer)
  basis?: 'quote' | 'listing';
}

export interface TeeRange {
  material: TeeMaterial;
  moq: number;
  overseas: TeeRegion;
  domestic: TeeRegion;
}

const cents = (usd: number): number => Math.round(usd * 100) / 100;
const tenWon = (krw: number): number => Math.round(krw / 10) * 10;

export function calculateTeeRange(material: TeeMaterial, evidence: EvidenceItem[], moq: number = GOLF_TEE_MOQ_PACKAGES): TeeRange {
  const domestic: TeeRegion = { status: 'insufficient', currency: 'KRW', reason: INSUFFICIENT_REASON.domestic };
  const none: TeeRegion = { status: 'insufficient', currency: 'USD', reason: INSUFFICIENT_REASON.overseas };
  if (material === 'unknown') {
    return { material, moq, overseas: none, domestic };
  }
  const rows = evidence.filter(
    item => item.region === 'overseas' && item.currency === 'USD' && (item as { product_type?: string }).product_type === `${material}_tee`
  );
  const quotes = rows.filter(item => item.price_kind === 'quote').map(item => ({ item }));
  const listings = withoutOutliers(rows.filter(item => item.price_kind === 'listing').map(item => ({ item })));
  const basis: 'quote' | 'listing' = quotes.length > 0 ? 'quote' : 'listing';
  const used = basis === 'quote' ? quotes : listings;
  const suppliers = new Set(used.map(({ item }) => item.supplier_name).filter(Boolean)).size;
  if (used.length === 0 || (basis === 'listing' && (used.length < MIN_LISTINGS || suppliers < MIN_SUPPLIERS))) {
    return { material, moq, overseas: none, domestic };
  }

  const points = used.map(({ item }) => ({ value: (item.price_min + item.price_max) / 2, weight: 1 }));
  let low = weightedPercentile(points, LOW_PERCENTILE);
  let high = weightedPercentile(points, HIGH_PERCENTILE);
  if (low === high) {
    [low, high] = [low * (1 - SINGLE_QUOTE_SPREAD), high * (1 + SINGLE_QUOTE_SPREAD)];
  }
  // per package of 50, with the golf tee margin
  const packageLow = cents(withTeeMargin(low) / PACKAGES_PER_EVIDENCE_UNIT);
  const packageHigh = cents(withTeeMargin(high) / PACKAGES_PER_EVIDENCE_UNIT);
  const unitKrw = { low: tenWon(packageLow * DISPLAY_USD_KRW), high: tenWon(packageHigh * DISPLAY_USD_KRW) };
  return {
    material,
    moq,
    overseas: {
      status: 'ok',
      currency: 'USD',
      low: packageLow,
      high: packageHigh,
      unit_krw: unitKrw,
      total_krw: { low: unitKrw.low * moq, high: unitKrw.high * moq },
      basis
    },
    domestic
  };
}

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Only approved golf tee rows are read.
export async function loadTeeEvidence(db: Queryable): Promise<EvidenceItem[]> {
  const result = await db.query(
    `SELECT region, product_type, price_kind, price_min::float8 AS price_min, price_max::float8 AS price_max, currency::text AS currency,
            upper_material, outsole, closure, supplier_name, supplier_type, source_url, source_title, collected_at::text AS collected_at
       FROM price_evidence
      WHERE category = 'golf_tee' AND status = 'approved'`
  );
  return result.rows as EvidenceItem[];
}

export async function getTeeRange(material: TeeMaterial, db: Queryable = getPool()): Promise<TeeRange> {
  return calculateTeeRange(material, await loadTeeEvidence(db));
}
