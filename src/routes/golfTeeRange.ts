import { Router, Request, Response } from 'express';
import { RANGE_NOTICE } from '../config/priceRangeRules';
import { TEES_PER_PACKAGE, TEE_MATERIALS, getTeeRange, type TeeMaterial, type TeeRegion } from '../services/golfTeeRangeService';
import logger from '../utils/logger';

const router = Router();

// What a customer is told about one region: never what the range rests on.
const publicTeeRegion = ({ basis: _basis, ...region }: TeeRegion): Omit<TeeRegion, 'basis'> => region;

// POST /api/estimate-preview/golf-tee-range: the overseas and the domestic price range of one package of golf tees (50 tees) from the
// material the photo analysis found or the visitor chose, and for the minimum order. Approved evidence only, nothing stored.
router.post('/estimate-preview/golf-tee-range', async (req: Request, res: Response) => {
  const { material } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof material !== 'string' || !(TEE_MATERIALS as readonly string[]).includes(material)) {
    res.status(400).json({
      error: 'Invalid golf tee range request',
      details: ['material: must be one of ' + TEE_MATERIALS.join(', ')],
      timestamp: new Date().toISOString()
    });
    return;
  }
  try {
    const range = await getTeeRange(material as TeeMaterial);
    res.json({
      spec: { material: range.material },
      unit: 'package',
      tees_per_package: TEES_PER_PACKAGE,
      moq: range.moq,
      overseas: publicTeeRegion(range.overseas),
      domestic: publicTeeRegion(range.domestic),
      notice: RANGE_NOTICE,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Golf tee range failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error', timestamp: new Date().toISOString() });
  }
});

export default router;
