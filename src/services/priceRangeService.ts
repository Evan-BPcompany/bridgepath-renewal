import { getPool } from '../config/database';
import { withServiceMargin } from '../config/serviceMargin';
import {
  DISPLAY_USD_KRW,
  CLOSURE_ADJUSTMENT,
  FRESH_DAYS,
  GOLF_SHOE_MOQ,
  HIGH_PERCENTILE,
  KIND_WEIGHT,
  LOW_PERCENTILE,
  MATERIAL_ADJUSTMENT,
  MAX_REFERENCES,
  MAX_RETAIL_REFERENCES,
  MEDIUM_CONFIDENCE_LISTINGS,
  MEDIUM_CONFIDENCE_SPREAD,
  MIN_LISTINGS,
  MIN_QUOTE_SIMILARITY,
  MIN_SIMILARITY,
  MIN_SUPPLIERS,
  OUTLIER_FACTOR,
  OUTSOLE_ADJUSTMENT,
  RANGE_REGIONS,
  REGION_CURRENCY,
  ROUNDING_STEP,
  SIMILARITY_WEIGHTS,
  SINGLE_QUOTE_SPREAD,
  STALE_DAYS,
  TRADING_WEIGHT,
  UNKNOWN_MATCH,
  type RangeRegion
} from '../config/priceRangeRules';

// A price range for a golf shoe, made from the APPROVED rows of price_evidence (migration 023) and nothing else: no row, no
// range. The number comes from code, never from a model. A range is shown with the sources it rests on, says whether it rests on
// real quotes or on public listing prices, and is "cannot quote" when the evidence is too thin.

export interface GolfShoeSpec {
  outsole: string; // spike, spikeless, hybrid, unknown
  closure: string; // dial, lace, strap, slip_on, mixed, unknown
  upper_material: string; // leather, synthetic, microfiber, mesh, mixed, unknown
}

export interface EvidenceItem {
  region: RangeRegion;
  price_kind: 'listing' | 'quote' | 'retail';
  price_min: number;
  price_max: number;
  currency: string;
  upper_material: string | null;
  outsole: string | null;
  closure: string | null;
  supplier_name: string | null;
  supplier_type: 'factory' | 'trading' | 'unknown';
  source_url: string | null;
  source_title: string;
  collected_at: string; // YYYY-MM-DD
}

export interface Reference {
  kind: EvidenceItem['price_kind'];
  title: string;
  url: string | null;
  supplier: string | null;
  price_min: number;
  price_max: number;
  currency: string;
  collected_at: string;
  similarity: number;
}

export interface RegionRange {
  status: 'ok' | 'insufficient';
  currency: 'USD' | 'KRW';
  low?: number;
  mid?: number;
  high?: number;
  // Only for the overseas range: the same range in won at the display rate.
  krw_low?: number;
  krw_high?: number;
  // "quote": real quotes only. "listing": public listing prices, a reference.
  basis?: 'quote' | 'listing';
  confidence?: 'low' | 'medium' | 'high';
  evidence_count: number;
  supplier_count: number;
  // Why there is no range (Korean, for the customer).
  reason?: string;
  references: Reference[];
  // Shop prices alike to the shoe: a reference for the market, never part of the range.
  retail_references: Reference[];
}

export interface GolfShoeRange {
  spec: GolfShoeSpec;
  overseas: RegionRange;
  domestic: RegionRange;
}

const known = (value: string | null): value is string => value !== null && value !== 'unknown';

function partMatch(wanted: string, found: string | null): number {
  if (!known(wanted) || !known(found)) {
    return UNKNOWN_MATCH;
  }
  if (wanted === found) {
    return 1;
  }
  const spikeFamily = ['spike', 'spikeless'];
  if ((wanted === 'hybrid' && spikeFamily.includes(found)) || (found === 'hybrid' && spikeFamily.includes(wanted))) {
    return 0.5;
  }
  return 0;
}

export function freshness(collectedAt: string, now: Date): number {
  const days = (now.getTime() - new Date(`${collectedAt}T00:00:00Z`).getTime()) / 86_400_000;
  if (days <= FRESH_DAYS) {
    return 1;
  }
  return days <= STALE_DAYS ? 0.5 : 0.2;
}

export function similarity(spec: GolfShoeSpec, item: EvidenceItem, now: Date): number {
  return (
    SIMILARITY_WEIGHTS.outsole * partMatch(spec.outsole, item.outsole) +
    SIMILARITY_WEIGHTS.closure * partMatch(spec.closure, item.closure) +
    SIMILARITY_WEIGHTS.upper_material * partMatch(spec.upper_material, item.upper_material) +
    SIMILARITY_WEIGHTS.freshness * freshness(item.collected_at, now)
  );
}

// The value at which the weights up to it reach the share p of the total weight.
export function weightedPercentile(points: Array<{ value: number; weight: number }>, p: number): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, point) => sum + point.weight, 0);
  let reached = 0;
  for (const point of sorted) {
    reached += point.weight;
    // (a tiny allowance: weights such as 0.9 + 0.9 + 0.9 add up to 2.7000000000000006 and would push the percentile one row up)
    if (reached >= p * total - 1e-9) {
      return point.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

const round = (value: number, step: number): number => Math.round(value / step) * step;
const clean = (value: number): number => Number(value.toFixed(2));

const toReference = (item: EvidenceItem, score: number): Reference => ({
  kind: item.price_kind,
  title: item.source_title,
  url: item.source_url,
  supplier: item.supplier_name,
  price_min: item.price_min,
  price_max: item.price_max,
  currency: item.currency,
  collected_at: item.collected_at,
  similarity: clean(score)
});

// What a customer reads when there is no range: that this spec needs the staff (never how many rows were found).
export const INSUFFICIENT_REASON: Record<RangeRegion, string> = {
  overseas: '이 사양은 상세견적이 필요합니다. 담당자가 확인해 드립니다.',
  domestic: '국내 기준은 상세견적이 필요한 사양입니다.'
};

const insufficient = (region: RangeRegion, scored: Array<{ item: EvidenceItem; score: number }>, retail: Reference[]): RegionRange => ({
  status: 'insufficient',
  currency: REGION_CURRENCY[region],
  evidence_count: scored.length,
  supplier_count: new Set(scored.map(({ item }) => item.supplier_name).filter(Boolean)).size,
  reason: INSUFFICIENT_REASON[region],
  references: [],
  retail_references: retail
});

const middleOf = (item: EvidenceItem): number => (item.price_min + item.price_max) / 2;

// A listing whose price is more than OUTLIER_FACTOR times above or below the median of the alike listings is not used: such a
// price is a different product or a mistake (the sample listings had a golf shoe at USD 153 next to USD 17-33 ones). A real quote
// is never dropped, and with fewer than three rows there is no median to measure against.
export function withoutOutliers<T extends { item: EvidenceItem }>(rows: T[]): T[] {
  if (rows.length < 3) {
    return rows;
  }
  const middle = weightedPercentile(rows.map(({ item }) => ({ value: middleOf(item), weight: 1 })), 0.5);
  return rows.filter(({ item }) => middleOf(item) <= middle * OUTLIER_FACTOR && middleOf(item) >= middle / OUTLIER_FACTOR);
}

// How much dearer or cheaper than the middle of the listings the shoe is, from its upper, outsole and closure (temporary factors,
// config/priceRangeRules.ts). A value that is not in a table counts 1.
export function adjustmentFactor(spec: GolfShoeSpec): number {
  return (MATERIAL_ADJUSTMENT[spec.upper_material] ?? 1) * (OUTSOLE_ADJUSTMENT[spec.outsole] ?? 1) * (CLOSURE_ADJUSTMENT[spec.closure] ?? 1);
}

// The minimum order of the shoe: 800 pairs with spikes or a dial closure, 300 pairs otherwise (config/priceRangeRules.ts).
export function golfShoeMoq(spec: GolfShoeSpec): number {
  return spec.outsole === 'spike' || spec.closure === 'dial' ? GOLF_SHOE_MOQ.complex : GOLF_SHOE_MOQ.standard;
}

export function calculateRegionRange(region: RangeRegion, spec: GolfShoeSpec, evidence: EvidenceItem[], now: Date): RegionRange {
  const currency = REGION_CURRENCY[region];
  const scoredAll = evidence
    .filter(item => item.region === region && item.currency === currency)
    .map(item => ({ item, score: similarity(spec, item, now) }))
    .filter(({ score }) => score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score);

  const retail = scoredAll
    .filter(({ item }) => item.price_kind === 'retail')
    .slice(0, MAX_RETAIL_REFERENCES)
    .map(({ item, score }) => toReference(item, score));
  const scored = scoredAll.filter(({ item }) => item.price_kind !== 'retail');

  // Real quotes beat listings: when there is one alike enough, the range rests on quotes only.
  const quotes = scored.filter(({ item, score }) => item.price_kind === 'quote' && score >= MIN_QUOTE_SIMILARITY);
  const basis: 'quote' | 'listing' = quotes.length > 0 ? 'quote' : 'listing';
  const used = basis === 'quote' ? quotes : withoutOutliers(scored.filter(({ item }) => item.price_kind === 'listing'));
  const suppliers = new Set(used.map(({ item }) => item.supplier_name).filter(Boolean)).size;

  if (basis === 'listing' && (used.length < MIN_LISTINGS || suppliers < MIN_SUPPLIERS)) {
    return insufficient(region, used, retail);
  }

  const points = used.map(({ item, score }) => ({
    value: (item.price_min + item.price_max) / 2,
    weight: score * KIND_WEIGHT[item.price_kind as 'quote' | 'listing'] * (item.supplier_type === 'trading' ? TRADING_WEIGHT : 1)
  }));
  // The listings are adjusted to the shoe of the photo; a real quote is the price of its own shoe and is not.
  const factor = basis === 'listing' ? adjustmentFactor(spec) : 1;
  let low = weightedPercentile(points, LOW_PERCENTILE) * factor;
  const mid = weightedPercentile(points, 0.5) * factor;
  let high = weightedPercentile(points, HIGH_PERCENTILE) * factor;
  if (low === high) {
    low = mid * (1 - SINGLE_QUOTE_SPREAD);
    high = mid * (1 + SINGLE_QUOTE_SPREAD);
  }

  const step = ROUNDING_STEP[currency];
  const shown = (value: number): number => clean(round(withServiceMargin(value), step));
  const [shownLow, shownMid, shownHigh] = [shown(low), shown(mid), shown(high)];
  const result: RegionRange = {
    status: 'ok',
    currency,
    low: shownLow,
    mid: shownMid,
    high: shownHigh,
    basis,
    confidence:
      basis === 'quote'
        ? used.length >= 2 ? 'high' : 'medium'
        : used.length >= MEDIUM_CONFIDENCE_LISTINGS && high / low <= MEDIUM_CONFIDENCE_SPREAD ? 'medium' : 'low',
    evidence_count: used.length,
    supplier_count: suppliers,
    references: used.slice(0, MAX_REFERENCES).map(({ item, score }) => toReference(item, score)),
    retail_references: retail
  };
  if (region === 'overseas') {
    result.krw_low = round(shownLow * DISPLAY_USD_KRW, ROUNDING_STEP.KRW);
    result.krw_high = round(shownHigh * DISPLAY_USD_KRW, ROUNDING_STEP.KRW);
  }
  return result;
}

export function calculateGolfShoeRange(spec: GolfShoeSpec, evidence: EvidenceItem[], now: Date = new Date()): GolfShoeRange {
  const [overseas, domestic] = RANGE_REGIONS.map(region => calculateRegionRange(region, spec, evidence, now));
  return { spec, overseas, domestic };
}

interface EvidenceRowFromDb {
  region: RangeRegion;
  price_kind: EvidenceItem['price_kind'];
  price_min: number;
  price_max: number;
  currency: string;
  upper_material: string | null;
  outsole: string | null;
  closure: string | null;
  supplier_name: string | null;
  supplier_type: EvidenceItem['supplier_type'];
  source_url: string | null;
  source_title: string;
  collected_at: string;
}

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Only rows with status 'approved' are ever read.
export async function loadGolfShoeEvidence(db: Queryable): Promise<EvidenceItem[]> {
  const result = await db.query(
    `SELECT region, price_kind, price_min::float8 AS price_min, price_max::float8 AS price_max, currency::text AS currency,
            upper_material, outsole, closure, supplier_name, supplier_type, source_url, source_title,
            collected_at::text AS collected_at
       FROM price_evidence
      WHERE category = 'shoes' AND status = 'approved'`
  );
  return (result.rows as EvidenceRowFromDb[]).map(row => ({ ...row }));
}

export async function getGolfShoeRange(spec: GolfShoeSpec, db: Queryable = getPool(), now: Date = new Date()): Promise<GolfShoeRange> {
  return calculateGolfShoeRange(spec, await loadGolfShoeEvidence(db), now);
}
