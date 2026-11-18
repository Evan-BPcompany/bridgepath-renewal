import { getPool } from '../config/database';
import { DISPLAY_USD_KRW, LOW_PERCENTILE, HIGH_PERCENTILE, MIN_LISTINGS, MIN_SUPPLIERS, ROUNDING_STEP } from '../config/priceRangeRules';
import {
  FRAMES,
  LENSES,
  calculateSunglassesCost,
  type Frame,
  type Lens,
  type SunglassesCost
} from '../config/sunglassesCostModel';
import { weightedPercentile, withoutOutliers, type EvidenceItem } from './priceRangeService';

// A row of evidence with the frame and the lens of migration 024.
export type SunglassesEvidence = EvidenceItem & { frame_material: string | null; lens_type: string | null };

// The answer for one pair of sunglasses: the cost SIMULATION of the model (config/sunglassesCostModel.ts) and, apart from it, the public
// supplier prices of the same kind of frame from the approved price evidence as they are listed (never multiplied by a factor).

export interface SunglassesCostRequest {
  // plastic: PC or TR90, which a photo cannot tell apart
  frame: Frame | 'plastic' | 'unknown';
  lens: Lens | 'unknown';
  mirror: boolean;
  gradient: boolean;
  photochromic: boolean;
  quantity: number;
}

export interface CostSpan {
  low: number;
  high: number;
}

export interface SunglassesSimulation {
  // A part that the photo or the visitor did not confirm is not chosen for them: the cost spans every value it can have.
  unconfirmed: Array<'frame' | 'lens'>;
  currency: 'USD';
  frame_cost: CostSpan;
  lens_cost: CostSpan;
  other_cost: number;
  unit_cost: CostSpan;
  total_cost: CostSpan;
  quantity: number;
  // The same in won at the display rate, rounded to 100 won.
  unit_krw: CostSpan;
  total_krw: CostSpan;
  estimate_type: 'simulation';
}

const span = (values: number[]): CostSpan => ({ low: Math.min(...values), high: Math.max(...values) });
const won = (usd: number): number => Math.round((usd * DISPLAY_USD_KRW) / ROUNDING_STEP.KRW) * ROUNDING_STEP.KRW;

export function simulateSunglassesCost(request: SunglassesCostRequest): SunglassesSimulation {
  const frames: Frame[] = request.frame === 'unknown' ? FRAMES : request.frame === 'plastic' ? ['pc', 'tr90'] : [request.frame];
  const lenses = request.lens === 'unknown' ? LENSES : [request.lens];
  const costs: SunglassesCost[] = frames.flatMap(frame =>
    lenses.map(lens =>
      calculateSunglassesCost({
        frame,
        lens,
        mirror: request.mirror,
        gradient: request.gradient,
        photochromic: request.photochromic,
        quantity: request.quantity
      })
    )
  );
  const unit = span(costs.map(cost => cost.unitCost));
  const total = span(costs.map(cost => cost.totalCost));
  return {
    unconfirmed: [...(request.frame === 'unknown' || request.frame === 'plastic' ? ['frame' as const] : []), ...(request.lens === 'unknown' ? ['lens' as const] : [])],
    currency: 'USD',
    frame_cost: span(costs.map(cost => cost.frameCost)),
    lens_cost: span(costs.map(cost => cost.lensCost)),
    other_cost: costs[0].otherCost,
    unit_cost: unit,
    total_cost: total,
    quantity: request.quantity,
    unit_krw: { low: won(unit.low), high: won(unit.high) },
    total_krw: { low: won(unit.low) * request.quantity, high: won(unit.high) * request.quantity },
    estimate_type: 'simulation'
  };
}

// The price evidence names frames as plastic, metal, acetate, wood (migration 024); PC and TR90 are both plastic there.
const EVIDENCE_FRAME: Record<Frame, string> = { pc: 'plastic', tr90: 'plastic', metal: 'metal', acetate: 'acetate', wood: 'wood', mixed: 'mixed' };

export interface SupplierReference {
  status: 'ok' | 'insufficient';
  // the 20th to 80th percentile of the listed prices of the same kind of frame, USD per pair as listed (no margin, no factor)
  low?: number;
  high?: number;
  unit_krw?: CostSpan;
}

// Public supplier prices of the same kind of frame, whatever their lens: only listings that name that frame, at least MIN_LISTINGS of
// them from MIN_SUPPLIERS suppliers, outliers left out. An unknown frame has no kind to compare with.
export function supplierReference(frame: Frame | 'plastic' | 'unknown', evidence: SunglassesEvidence[]): SupplierReference {
  if (frame === 'unknown') {
    return { status: 'insufficient' };
  }
  const rows = withoutOutliers(
    evidence
      .filter(item => item.region === 'overseas' && item.currency === 'USD' && item.price_kind === 'listing' && item.frame_material === (frame === 'plastic' ? 'plastic' : EVIDENCE_FRAME[frame]))
      .map(item => ({ item }))
  );
  const suppliers = new Set(rows.map(({ item }) => item.supplier_name).filter(Boolean)).size;
  if (rows.length < MIN_LISTINGS || suppliers < MIN_SUPPLIERS) {
    return { status: 'insufficient' };
  }
  const points = rows.map(({ item }) => ({ value: (item.price_min + item.price_max) / 2, weight: 1 }));
  const low = Math.round(weightedPercentile(points, LOW_PERCENTILE) * 10) / 10;
  const high = Math.round(weightedPercentile(points, HIGH_PERCENTILE) * 10) / 10;
  return { status: 'ok', low, high, unit_krw: { low: won(low), high: won(high) } };
}

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Only approved sunglasses rows are read.
export async function loadSunglassesEvidence(db: Queryable): Promise<SunglassesEvidence[]> {
  const result = await db.query(
    `SELECT region, price_kind, price_min::float8 AS price_min, price_max::float8 AS price_max, currency::text AS currency,
            upper_material, outsole, closure, frame_material, lens_type, supplier_name, supplier_type, source_url, source_title,
            collected_at::text AS collected_at
       FROM price_evidence
      WHERE category = 'sunglasses' AND status = 'approved'`
  );
  return result.rows as SunglassesEvidence[];
}

export async function getSunglassesReference(frame: Frame | 'plastic' | 'unknown', db: Queryable = getPool()): Promise<SupplierReference> {
  return frame === 'unknown' ? { status: 'insufficient' } : supplierReference(frame, await loadSunglassesEvidence(db));
}
