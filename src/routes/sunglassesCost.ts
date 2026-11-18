import { Router, Request, Response } from 'express';
import { BASE_QUANTITY, FRAMES, LENSES } from '../config/sunglassesCostModel';
import { getSunglassesReference, simulateSunglassesCost } from '../services/sunglassesCostService';
import { INSUFFICIENT_REASON } from '../services/priceRangeService';
import logger from '../utils/logger';

const router = Router();

const MAX_QUANTITY = 1_000_000;

export const SIMULATION_NOTICE =
  '가상견적입니다. 프레임·렌즈·기타 비용을 나눠 계산한 예상 제조원가이며, 실제 공장 견적이나 공급업체 판매가격이 아닙니다. 신규 금형비·국제운송비·관세·부가세는 포함하지 않았습니다. 정식 견적은 담당자가 확인한 뒤 안내드립니다.';
export const REFERENCE_NOTICE = '같은 프레임 소재 선글라스의 공개 공급가격(완제품, 공장 마진 포함)으로, 위 예상 제조원가와 기준이 다릅니다.';
export const UNCONFIRMED_NOTICE: Record<'frame' | 'lens', string> = {
  frame: '프레임 소재가 확인되지 않아 가능한 소재의 범위로 계산했습니다. 플라스틱은 PC와 TR90 사이의 범위입니다.',
  lens: '렌즈 소재와 편광 여부는 사진으로 확인할 수 없어 가능한 렌즈 전체의 범위로 계산했습니다. 렌즈를 선택하면 다시 계산합니다.'
};

const isOneOf = (allowed: readonly string[], value: unknown): value is string => typeof value === 'string' && allowed.includes(value);

// POST /api/estimate-preview/sunglasses-cost: the cost simulation of one pair of sunglasses from its frame, its lens and the lens
// options (what the photo analysis found or the visitor chose), and, apart from it, the public supplier prices of the same frame.
// A part sent as "unknown" is not decided for the visitor: the cost spans its values. Nothing is stored and no personal data is asked.
router.post('/estimate-preview/sunglasses-cost', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!isOneOf([...FRAMES, 'plastic', 'unknown'], body.frame)) {
    problems.push('frame: must be one of ' + [...FRAMES, 'plastic', 'unknown'].join(', '));
  }
  if (!isOneOf([...LENSES, 'unknown'], body.lens)) {
    problems.push('lens: must be one of ' + [...LENSES, 'unknown'].join(', '));
  }
  for (const option of ['mirror', 'gradient', 'photochromic']) {
    if (body[option] !== undefined && typeof body[option] !== 'boolean') {
      problems.push(`${option}: must be true or false`);
    }
  }
  const quantity = body.quantity === undefined ? BASE_QUANTITY : body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    problems.push(`quantity: must be a whole number from 1 to ${MAX_QUANTITY}`);
  }
  if (problems.length > 0) {
    res.status(400).json({ error: 'Invalid sunglasses cost request', details: problems, timestamp: new Date().toISOString() });
    return;
  }

  const spec = {
    frame: body.frame as (typeof FRAMES)[number] | 'plastic' | 'unknown',
    lens: body.lens as (typeof LENSES)[number] | 'unknown',
    mirror: body.mirror === true,
    gradient: body.gradient === true,
    photochromic: body.photochromic === true,
    quantity: quantity as number
  };
  try {
    const simulation = simulateSunglassesCost(spec);
    res.json({
      spec,
      unit: 'piece',
      simulation,
      supplier_reference: { ...(await getSunglassesReference(spec.frame)), notice: REFERENCE_NOTICE },
      domestic: { status: 'insufficient', reason: INSUFFICIENT_REASON.domestic },
      assumptions: simulation.unconfirmed.map(part => UNCONFIRMED_NOTICE[part]),
      notice: SIMULATION_NOTICE,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Sunglasses cost failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal Server Error', timestamp: new Date().toISOString() });
  }
});

export default router;
