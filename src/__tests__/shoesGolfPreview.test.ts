jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { BasePriceRow, calculateGolfTeePreview, calculateShoesPreview } from '../services/estimatePreviewService';
import { validateSpecification } from '../utils/specification';
import {
  SHOES_MIN_QUANTITY,
  TEE_MIN_PACKAGES,
  TEE_PIECES_PER_PACKAGE
} from '../config/shoesGolfPricingRules';

// The base prices are those of migration 020 (the median factory prices of 2026-10-26).
const SHOE_PRICES: BasePriceRow[] = [
  { product_variant: 'Sneakers', base_price: 13860 },
  { product_variant: 'Heels', base_price: 11430 },
  { product_variant: 'Mens Dress', base_price: 24030 },
  { product_variant: 'Boots', base_price: 16400 },
  { product_variant: 'Sandals', base_price: 7910 }
];
const TEE_PRICES: BasePriceRow[] = [
  { product_variant: 'Wood Tee', base_price: 23.8 },
  { product_variant: 'Bamboo Tee', base_price: 33.1 },
  { product_variant: 'Plastic Tee', base_price: 33.1 }
];

describe('the minimum orders', () => {
  it('are 600 pairs of shoes and 1,000 packages of golf tees, and a package holds 50 tees', () => {
    expect(SHOES_MIN_QUANTITY).toBe(600);
    expect(TEE_MIN_PACKAGES).toBe(1000);
    expect(TEE_PIECES_PER_PACKAGE).toBe(50);
  });
});

describe('calculateShoesPreview', () => {
  it('gives no price below 600 pairs, and says the minimum', () => {
    expect(calculateShoesPreview({ shoe_type: 'sneakers', material: 'mesh', quantity: 599 }, SHOE_PRICES)).toEqual({
      available: false,
      reason: 'BELOW_MINIMUM',
      minimum_quantity: 600
    });
  });

  it('prices a known type and material at the minimum order as a rounded range', () => {
    const result = calculateShoesPreview({ shoe_type: 'sneakers', material: 'mesh', quantity: 600 }, SHOE_PRICES);

    // 13860 x 0.95 (mesh) x 1.1 (600-999) = 14484.3; range -/+20%.
    expect(result).toEqual({
      available: true,
      currency: 'KRW',
      quantity: 600,
      unit_price: { min: 11600, max: 17400 },
      total_price: { min: 6960000, max: 10440000 }
    });
  });

  it('is cheaper per pair for larger orders and dearer for leather than for rubber', () => {
    const at = (quantity: number, material = 'mesh') =>
      calculateShoesPreview({ shoe_type: 'boots', material, quantity }, SHOE_PRICES) as { unit_price: { min: number } };

    expect(at(10000).unit_price.min).toBeLessThan(at(3000).unit_price.min);
    expect(at(3000).unit_price.min).toBeLessThan(at(1000).unit_price.min);
    expect(at(1000).unit_price.min).toBeLessThan(at(600).unit_price.min);
    expect(at(600, 'leather').unit_price.min).toBeGreaterThan(at(600, 'rubber').unit_price.min);
  });

  it('prices an unknown type or material across all types, with a wider range', () => {
    const known = calculateShoesPreview({ shoe_type: 'sneakers', material: 'mesh', quantity: 1000 }, SHOE_PRICES) as { unit_price: { min: number; max: number } };
    const unknownType = calculateShoesPreview({ shoe_type: 'other', material: 'mesh', quantity: 1000 }, SHOE_PRICES) as { unit_price: { min: number; max: number } };
    const unknownBoth = calculateShoesPreview({ shoe_type: 'other', material: 'unknown', quantity: 1000 }, SHOE_PRICES) as { unit_price: { min: number; max: number } };

    expect(unknownType.unit_price.min).toBeLessThan(known.unit_price.min);
    expect(unknownType.unit_price.max).toBeGreaterThan(known.unit_price.max);
    expect(unknownBoth.unit_price.max - unknownBoth.unit_price.min).toBeGreaterThan(unknownType.unit_price.max - unknownType.unit_price.min);
  });

  it('says there is no base price when none is set up', () => {
    expect(calculateShoesPreview({ shoe_type: 'sneakers', material: 'mesh', quantity: 600 }, [])).toEqual({ available: false, reason: 'NO_BASE_PRICE' });
  });
});

describe('calculateGolfTeePreview', () => {
  it('gives no price below 1,000 packages, and says the minimum', () => {
    expect(calculateGolfTeePreview({ material: 'wood', quantity: 999 }, TEE_PRICES)).toEqual({
      available: false,
      reason: 'BELOW_MINIMUM',
      minimum_quantity: 1000
    });
  });

  it('prices a package of 50 tees: the price of a tee times 50, as a range rounded to ten won', () => {
    const result = calculateGolfTeePreview({ material: 'wood', quantity: 1000 }, TEE_PRICES);

    // 23.8 x 50 = 1190 per package; range -/+25%.
    expect(result).toEqual({
      available: true,
      currency: 'KRW',
      quantity: 1000,
      unit_price: { min: 890, max: 1490 },
      total_price: { min: 890000, max: 1490000 }
    });
  });

  it('is cheaper per package for large orders, and wood is cheaper than bamboo', () => {
    const at = (material: string, quantity: number) =>
      calculateGolfTeePreview({ material, quantity }, TEE_PRICES) as { unit_price: { min: number; max: number } };

    expect(at('wood', 20000).unit_price.max).toBeLessThan(at('wood', 1000).unit_price.max);
    expect(at('wood', 1000).unit_price.max).toBeLessThan(at('bamboo', 1000).unit_price.max);
  });

  it('prices an unknown material across the three materials, with a wider range', () => {
    const wood = calculateGolfTeePreview({ material: 'wood', quantity: 1000 }, TEE_PRICES) as { unit_price: { min: number; max: number } };
    const unknown = calculateGolfTeePreview({ material: 'unknown', quantity: 1000 }, TEE_PRICES) as { unit_price: { min: number; max: number } };

    expect(unknown.unit_price.min).toBeLessThan(wood.unit_price.max);
    expect(unknown.unit_price.max).toBeGreaterThan(wood.unit_price.max);
  });

  it('ignores a row that is not a tee (an old golf sample)', () => {
    const rows = [{ product_variant: 'Golf Ball', base_price: 5000 }, ...TEE_PRICES];

    expect(calculateGolfTeePreview({ material: 'unknown', quantity: 1000 }, rows)).toEqual(
      calculateGolfTeePreview({ material: 'unknown', quantity: 1000 }, TEE_PRICES)
    );
  });

  it('says there is no base price when none is set up', () => {
    expect(calculateGolfTeePreview({ material: 'wood', quantity: 1000 }, [])).toEqual({ available: false, reason: 'NO_BASE_PRICE' });
  });
});

describe('POST /api/estimate-preview for shoes and golf tees', () => {
  const query = jest.fn();
  const post = (body: unknown) => request(createApp()).post('/api/estimate-preview').send(body as object);

  beforeEach(() => {
    query.mockReset();
    (getPool as jest.Mock).mockReturnValue({ query });
  });

  it('answers a shoe request, in pairs, with the type taken from the category', async () => {
    query.mockResolvedValue({ rows: SHOE_PRICES });

    const res = await post({ category: 'sneakers', material: 'mesh', quantity: 600 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, currency: 'KRW', quantity: 600, unit: 'pair', unit_price: { min: 11600, max: 17400 } });
    expect(query.mock.calls[0][1]).toEqual(['shoes']);
    expect(JSON.stringify(res.body)).not.toMatch(/base_price|product_variant|수수료/);
  });

  it('answers "below the minimum" for 599 pairs, with the minimum, as a normal answer', async () => {
    query.mockResolvedValue({ rows: SHOE_PRICES });

    const res = await post({ category: 'shoes', material: 'leather', quantity: 599 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, reason: 'BELOW_MINIMUM', minimum_quantity: 600 });
  });

  it('answers a golf tee request, in packages of 50', async () => {
    query.mockResolvedValue({ rows: TEE_PRICES });

    const res = await post({ category: 'golf_tee', material: 'wood', quantity: 1000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, unit: 'package', pieces_per_package: 50, unit_price: { min: 890, max: 1490 } });
    expect(query.mock.calls[0][1]).toEqual(['golf_products']);
  });

  it('answers "below the minimum" for 999 packages', async () => {
    query.mockResolvedValue({ rows: TEE_PRICES });

    const res = await post({ category: 'golf_tee', material: 'bamboo', quantity: 999 });

    expect(res.body).toMatchObject({ available: false, reason: 'BELOW_MINIMUM', minimum_quantity: 1000 });
  });

  it.each([
    ['sneakers', { material: 'wool', quantity: 600 }],
    ['sneakers', { material: 'mesh', quantity: 0 }],
    ['sneakers', { material: 'mesh', quantity: 600.5 }],
    ['sneakers', { material: 'mesh', quantity: '600' }],
    ['sneakers', { quantity: 600 }],
    ['golf_tee', { material: 'steel', quantity: 1000 }],
    ['golf_tee', { material: 'wood', quantity: -1 }],
    ['golf_tee', { material: 'wood', quantity: 2000000 }]
  ])('refuses %s %j with 400 and asks the database nothing', async (category, rest) => {
    const res = await post({ category, ...rest });

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('the minimum orders in the specification of a request', () => {
  const shoes = (quantity: number) => ({ schema_version: '1.0', shoe_type: 'Running', material: 'Mesh', size_range: '240-250', quantity });
  const tee = (quantity: number) => ({ schema_version: '1.0', product_type: 'golf_tee', material: 'wood', quantity });

  it('accepts 600 pairs of shoes and refuses 599, with the minimum in the message', () => {
    expect(validateSpecification('sneakers', shoes(600)).valid).toBe(true);
    const refused = validateSpecification('sneakers', shoes(599));

    expect(refused.valid).toBe(false);
    expect(refused.errors?.join(' ')).toContain('at least 600');
  });

  it('accepts 1,000 packages of golf tees and refuses 999, whichever way the request says it is a tee', () => {
    expect(validateSpecification('golf_tee', tee(1000)).valid).toBe(true);
    expect(validateSpecification('golf_products', tee(1000)).valid).toBe(true);
    expect(validateSpecification('golf_tee', tee(999)).valid).toBe(false);
    expect(validateSpecification('golf_products', tee(999)).valid).toBe(false);
  });

  it('leaves other golf products and the sunglasses with their old minimum of 1', () => {
    expect(validateSpecification('bags', { schema_version: '1.0', product_type: 'bag', material: 'nylon', quantity: 50 }).valid).toBe(true);
    expect(validateSpecification('sunglasses', { schema_version: '1.0', frame_type: 'x', material: 'x', lens_type: 'x', quantity: 1 }).valid).toBe(true);
  });
});
