jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import request from 'supertest';
import { getPool } from '../config/database';
import { createApp } from '../app';
import { calculateSunglassesPreview, BasePriceRow } from '../services/estimatePreviewService';
import { PREVIEW_NOTICE } from '../routes/estimatePreview';

// The base prices below are the development samples (migration 005). The multipliers come from
// config/sunglassesPricingRules.ts, so a change there changes these expectations on purpose.
const BASE_PRICES: BasePriceRow[] = [
  { product_variant: 'Plastic Frame', base_price: 15000 },
  { product_variant: 'Metal Frame', base_price: 25000 },
  { product_variant: 'Mixed Frame', base_price: 50000 }
];

describe('calculateSunglassesPreview', () => {
  it('prices a known material and lens with the quantity tier, as a rounded range', () => {
    const result = calculateSunglassesPreview(
      { material: 'plastic', lens_type: 'normal', quantity: 500 },
      BASE_PRICES
    );

    // 15000 x 1.0 (lens) x 1.0 (300-999) = 15000, range -/+15%.
    expect(result).toEqual({
      available: true,
      currency: 'KRW',
      quantity: 500,
      unit_price: { min: 12800, max: 17300 },
      total_price: { min: 6400000, max: 8650000 }
    });
  });

  it('applies the lens multiplier and a cheaper tier for large orders', () => {
    const result = calculateSunglassesPreview(
      { material: 'metal', lens_type: 'polarized', quantity: 1000 },
      BASE_PRICES
    );

    // 25000 x 1.25 x 0.9 = 28125, range -/+15%.
    expect(result).toMatchObject({ available: true, unit_price: { min: 23900, max: 32300 } });
  });

  it.each([
    [1, 1.3],
    [99, 1.3],
    [100, 1.15],
    [299, 1.15],
    [300, 1.0],
    [999, 1.0],
    [1000, 0.9],
    [4999, 0.9],
    [5000, 0.82],
    [1000000, 0.82]
  ])('uses the right tier at quantity %i', (quantity, multiplier) => {
    const result = calculateSunglassesPreview(
      { material: 'plastic', lens_type: 'normal', quantity },
      BASE_PRICES
    );
    const expectedMid = 15000 * multiplier;
    if (!result.available) {
      throw new Error('expected a price');
    }
    const mid = (result.unit_price.min + result.unit_price.max) / 2;
    // Rounding to 100 won moves each end by at most 50 won.
    expect(Math.abs(mid - expectedMid)).toBeLessThanOrEqual(100);
  });

  it('prices an unknown material across all variants with a wider range', () => {
    const result = calculateSunglassesPreview(
      { material: 'unknown', lens_type: 'unknown', quantity: 100 },
      BASE_PRICES
    );

    // Two unknown answers: spread 0.15 + 2 x 0.10 = 0.35. Low: 15000 x 1.15 x 0.65; high: 50000 x 1.15 x 1.35.
    expect(result).toMatchObject({ available: true, unit_price: { min: 11200, max: 77600 } });
  });

  it('treats a material without an active price like an unknown one', () => {
    const known = calculateSunglassesPreview(
      { material: 'plastic', lens_type: 'normal', quantity: 500 },
      BASE_PRICES
    );
    const noRow = calculateSunglassesPreview(
      { material: 'wood', lens_type: 'normal', quantity: 500 },
      BASE_PRICES
    );

    if (!known.available || !noRow.available) {
      throw new Error('expected prices');
    }
    expect(noRow.unit_price.max - noRow.unit_price.min).toBeGreaterThan(
      known.unit_price.max - known.unit_price.min
    );
  });

  it('is not available when there is no base price at all', () => {
    expect(
      calculateSunglassesPreview({ material: 'plastic', lens_type: 'normal', quantity: 500 }, [])
    ).toEqual({ available: false, reason: 'NO_BASE_PRICE' });
  });

  it('keeps total = unit x quantity at both ends', () => {
    const result = calculateSunglassesPreview(
      { material: 'metal', lens_type: 'mirror', quantity: 333 },
      BASE_PRICES
    );
    if (!result.available) {
      throw new Error('expected a price');
    }
    expect(result.total_price.min).toBe(result.unit_price.min * 333);
    expect(result.total_price.max).toBe(result.unit_price.max * 333);
  });
});

describe('POST /api/estimate-preview', () => {
  const query = jest.fn();
  const valid = { category: 'sunglasses', material: 'plastic', lens_type: 'normal', quantity: 500 };

  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: BASE_PRICES });
    jest.mocked(getPool).mockReturnValue({ query } as never);
  });

  it('returns the price range and the not-a-quote notice', async () => {
    const res = await request(createApp()).post('/api/estimate-preview').send(valid);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true,
      currency: 'KRW',
      unit_price: { min: 12800, max: 17300 },
      notice: PREVIEW_NOTICE
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reads only the active eyewear base prices', async () => {
    await request(createApp()).post('/api/estimate-preview').send(valid);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('is_active = true');
    expect(params).toEqual(['eyewear']);
  });

  it('never exposes internal fields or the service fee', async () => {
    const res = await request(createApp()).post('/api/estimate-preview').send(valid);
    const text = JSON.stringify(res.body);

    expect(text).not.toMatch(/base_price|product_variant|fee|수수료/i);
  });

  it('answers available:false for a category that is not priced yet', async () => {
    const res = await request(createApp())
      .post('/api/estimate-preview')
      .send({ ...valid, category: 'shoes' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, reason: 'CATEGORY_NOT_SUPPORTED' });
    expect(query).not.toHaveBeenCalled();
  });

  it('answers available:false when no base price is set up', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(createApp()).post('/api/estimate-preview').send(valid);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, reason: 'NO_BASE_PRICE' });
  });

  it.each([
    ['missing category', { ...valid, category: undefined }],
    ['unknown material', { ...valid, material: 'gold' }],
    ['unknown lens', { ...valid, lens_type: 'x-ray' }],
    ['zero quantity', { ...valid, quantity: 0 }],
    ['fractional quantity', { ...valid, quantity: 10.5 }],
    ['quantity as text', { ...valid, quantity: '500' }],
    ['huge quantity', { ...valid, quantity: 1000001 }]
  ])('rejects %s with 400 and no database read', async (_name, body) => {
    const res = await request(createApp()).post('/api/estimate-preview').send(body);

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers 500 without details when the database fails', async () => {
    query.mockRejectedValue(new Error('connection refused to db.internal:5432'));

    const res = await request(createApp()).post('/api/estimate-preview').send(valid);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('db.internal');
  });

  it('is rate limited per client IP', async () => {
    const app = createApp({ rateLimits: { estimatePreview: { windowMs: 60000, max: 1 } } });

    const first = await request(app).post('/api/estimate-preview').send(valid);
    const second = await request(app).post('/api/estimate-preview').send(valid);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('RATE_LIMITED');
  });
});
