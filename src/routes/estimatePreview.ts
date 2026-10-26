import { Router, Request, Response } from 'express';
import { CATEGORY_MAPPING } from '../utils/specification';
import { getGolfTeePreview, getShoesPreview, getSunglassesPreview } from '../services/estimatePreviewService';
import {
  GOLF_CATEGORY,
  SHOES_CATEGORY,
  SHOES_MAX_QUANTITY,
  SHOE_MATERIAL_MULTIPLIERS,
  SHOE_TYPES,
  TEE_MATERIAL_VARIANTS,
  TEE_MAX_PACKAGES,
  TEE_PIECES_PER_PACKAGE
} from '../config/shoesGolfPricingRules';
import {
  LENS_MULTIPLIERS,
  MATERIAL_VARIANTS,
  MAX_QUANTITY,
  MIN_QUANTITY,
  SUNGLASSES_CATEGORY,
  UNKNOWN_VALUE
} from '../config/sunglassesPricingRules';
import logger from '../utils/logger';

const router = Router();

// Shown with every preview. It is guidance only; the binding quote comes from a staff member
// after the factory and shipping conditions are checked (PRD FR-3). Do not add the service fee
// here: it is not disclosed in the price guidance.
export const PREVIEW_NOTICE =
  '입력하신 정보로 계산한 예상 범위이며 확정 견적이 아닙니다. 정식 견적은 담당자가 공장·운송 조건을 확인한 뒤 안내드립니다.';

const MATERIALS = new Set([...Object.keys(MATERIAL_VARIANTS), UNKNOWN_VALUE]);
const LENS_TYPES = new Set(Object.keys(LENS_MULTIPLIERS));

function badRequest(res: Response, error: string, details?: string[]): void {
  res.status(400).json({
    error,
    ...(details ? { details } : {}),
    timestamp: new Date().toISOString()
  });
}

const SHOE_MATERIALS = new Set(Object.keys(SHOE_MATERIAL_MULTIPLIERS));
const TEE_MATERIALS = new Set([...Object.keys(TEE_MATERIAL_VARIANTS), UNKNOWN_VALUE]);

const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

// Shoes: the category of the request is the shoe type (sneakers, heels, ...). Below the minimum order
// (600 pairs) the answer is "unavailable" with the minimum, not an error: the form shows it.
async function previewShoes(req: Request, res: Response, category: string): Promise<void> {
  const { material, quantity } = (req.body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof material !== 'string' || !SHOE_MATERIALS.has(material)) {
    problems.push('material: must be one of ' + Array.from(SHOE_MATERIALS).join(', '));
  }
  if (!isCount(quantity, SHOES_MAX_QUANTITY)) {
    problems.push(`quantity: must be an integer from 1 to ${SHOES_MAX_QUANTITY}`);
  }
  if (problems.length > 0) {
    badRequest(res, 'Invalid estimate preview request', problems);
    return;
  }
  const shoeType = SHOE_TYPES.includes(category) ? category : 'other';
  const preview = await getShoesPreview({ shoe_type: shoeType, material: material as string, quantity: quantity as number });
  res.json({ ...preview, unit: 'pair', notice: PREVIEW_NOTICE, timestamp: new Date().toISOString() });
}

// Golf tees: the quantity is counted in packages of 50 tees, and so is the unit price.
async function previewGolfTee(req: Request, res: Response): Promise<void> {
  const { material, quantity } = (req.body ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof material !== 'string' || !TEE_MATERIALS.has(material)) {
    problems.push('material: must be one of ' + Array.from(TEE_MATERIALS).join(', '));
  }
  if (!isCount(quantity, TEE_MAX_PACKAGES)) {
    problems.push(`quantity: must be an integer from 1 to ${TEE_MAX_PACKAGES} (packages of ${TEE_PIECES_PER_PACKAGE})`);
  }
  if (problems.length > 0) {
    badRequest(res, 'Invalid estimate preview request', problems);
    return;
  }
  const preview = await getGolfTeePreview({ material: material as string, quantity: quantity as number });
  res.json({ ...preview, unit: 'package', pieces_per_package: TEE_PIECES_PER_PACKAGE, notice: PREVIEW_NOTICE, timestamp: new Date().toISOString() });
}

// POST /api/estimate-preview: a price range for a sunglasses request. It stores nothing and asks
// for no personal data, so it needs no consent and no access token.
router.post('/estimate-preview', async (req: Request, res: Response) => {
  try {
    const { category, material, lens_type, quantity } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof category !== 'string' || category.length === 0) {
      badRequest(res, 'Missing required field: category');
      return;
    }

    // Shoes and golf tees have their own rules (and a minimum order); see below.
    if (CATEGORY_MAPPING[category] === SHOES_CATEGORY) {
      await previewShoes(req, res, category);
      return;
    }
    if (CATEGORY_MAPPING[category] === GOLF_CATEGORY) {
      await previewGolfTee(req, res);
      return;
    }

    // Other categories are answered, not rejected, so the front end can fall back to the plain
    // request form.
    if (CATEGORY_MAPPING[category] !== SUNGLASSES_CATEGORY) {
      res.json({
        available: false,
        reason: 'CATEGORY_NOT_SUPPORTED',
        notice: PREVIEW_NOTICE,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const problems: string[] = [];
    if (typeof material !== 'string' || !MATERIALS.has(material)) {
      problems.push('material: must be one of ' + Array.from(MATERIALS).join(', '));
    }
    if (typeof lens_type !== 'string' || !LENS_TYPES.has(lens_type)) {
      problems.push('lens_type: must be one of ' + Array.from(LENS_TYPES).join(', '));
    }
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < MIN_QUANTITY ||
      quantity > MAX_QUANTITY
    ) {
      problems.push(`quantity: must be an integer from ${MIN_QUANTITY} to ${MAX_QUANTITY}`);
    }
    if (problems.length > 0) {
      badRequest(res, 'Invalid estimate preview request', problems);
      return;
    }

    const preview = await getSunglassesPreview({
      material: material as string,
      lens_type: lens_type as string,
      quantity: quantity as number
    });

    res.json({ ...preview, notice: PREVIEW_NOTICE, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('Estimate preview failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({
      error: 'Internal Server Error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
