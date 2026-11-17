import { Router, Request, Response } from 'express';
import { CLOSURES, OUTSOLES, UPPER_MATERIALS } from '../services/golfShoeAnalysisService';
import { getGolfShoeRange, golfShoeMoq, type RegionRange } from '../services/priceRangeService';
import { RANGE_NOTICE } from '../config/priceRangeRules';
import logger from '../utils/logger';

const router = Router();

const isOneOf = (allowed: readonly string[], value: unknown): value is string => typeof value === 'string' && allowed.includes(value);

// What a customer is told about one region: the range, in won, for one pair and for the minimum order. Never the sources, the number
// of rows or the suppliers the range rests on (the service keeps them for the staff).
export interface PublicRegion {
  status: 'ok' | 'insufficient';
  currency: 'USD' | 'KRW';
  low?: number;
  high?: number;
  unit_krw?: { low: number; high: number };
  total_krw?: { low: number; high: number };
  reason?: string;
}

export function publicRegion(region: RegionRange, moq: number): PublicRegion {
  if (region.status !== 'ok' || region.low === undefined || region.high === undefined) {
    return { status: 'insufficient', currency: region.currency, reason: region.reason };
  }
  const unit = region.currency === 'USD' ? { low: region.krw_low as number, high: region.krw_high as number } : { low: region.low, high: region.high };
  return {
    status: 'ok',
    currency: region.currency,
    low: region.low,
    high: region.high,
    unit_krw: unit,
    total_krw: { low: unit.low * moq, high: unit.high * moq }
  };
}

// POST /api/estimate-preview/golf-shoe-range: the overseas and the domestic price range of a golf shoe from what the photo
// analysis found (or what the visitor corrected it to). It reads approved price evidence only, stores nothing and asks for no
// personal data. The body is the three values of the analysis, so a corrected value gives a new range at once.
router.post('/estimate-preview/golf-shoe-range', async (req: Request, res: Response) => {
  const { outsole, closure, upper_material: upperMaterial } = (req.body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!isOneOf(OUTSOLES, outsole)) {
    problems.push('outsole: must be one of ' + OUTSOLES.join(', '));
  }
  if (!isOneOf(CLOSURES, closure)) {
    problems.push('closure: must be one of ' + CLOSURES.join(', '));
  }
  if (!isOneOf(UPPER_MATERIALS, upperMaterial)) {
    problems.push('upper_material: must be one of ' + UPPER_MATERIALS.join(', '));
  }
  if (problems.length > 0) {
    res.status(400).json({ error: 'Invalid golf shoe range request', details: problems, timestamp: new Date().toISOString() });
    return;
  }

  try {
    const range = await getGolfShoeRange({ outsole: outsole as string, closure: closure as string, upper_material: upperMaterial as string });
    // 800 pairs with spikes or a dial, 300 pairs otherwise; the total budget of each region is the range times it.
    const moq = golfShoeMoq(range.spec);
    res.json({
      spec: range.spec,
      unit: 'pair',
      moq,
      overseas: publicRegion(range.overseas, moq),
      domestic: publicRegion(range.domestic, moq),
      notice: RANGE_NOTICE,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Golf shoe range failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error', timestamp: new Date().toISOString() });
  }
});

export default router;
