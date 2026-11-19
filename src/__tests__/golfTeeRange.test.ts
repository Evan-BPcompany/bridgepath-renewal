jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/golfTeeRangeService', () => ({
  ...jest.requireActual('../services/golfTeeRangeService'),
  getTeeRange: jest.fn()
}));

import request from 'supertest';
import { createApp } from '../app';
import { calculateTeeRange, getTeeRange, GOLF_TEE_MOQ_PACKAGES } from '../services/golfTeeRangeService';
import type { EvidenceItem } from '../services/priceRangeService';
import { RANGE_NOTICE } from '../config/priceRangeRules';

const row = (extra: Partial<EvidenceItem> & { product_type: string }): EvidenceItem =>
  ({
    region: 'overseas',
    price_kind: 'listing',
    price_min: 5,
    price_max: 5,
    currency: 'USD',
    upper_material: null,
    outsole: null,
    closure: null,
    supplier_name: 'Supplier',
    supplier_type: 'unknown',
    source_url: 'https://example.com',
    source_title: 'Golf tees',
    collected_at: '2026-11-18',
    ...extra
  }) as EvidenceItem;

// The real quote of migration 021 per 100 tees (2 packages of 50): 60/65/70 mm USD 3.64 / 3.80 / 4.00.
const QUOTES = [3.64, 3.8, 4].map((price, index) => row({ product_type: 'bamboo_tee', price_kind: 'quote', price_min: price, price_max: price, supplier_name: null, source_url: null, source_title: `quote ${index}` }));
const BAMBOO_LISTINGS = [1, 3, 7, 8, 8.5].map((price, index) => row({ product_type: 'bamboo_tee', price_min: price, price_max: price, supplier_name: `S${index}` }));

describe('calculateTeeRange', () => {
  it('rests on the real quote of the material, per package of 50 with the golf tee margin of 21 % and the bamboo factor 1.1, before any listing', () => {
    const range = calculateTeeRange('bamboo', [...QUOTES, ...BAMBOO_LISTINGS]);

    // 3.64 / 2 x 1.21 x 1.1 = 2.42, 4.00 / 2 x 1.21 x 1.1 = 2.66
    expect(range.overseas).toMatchObject({ status: 'ok', currency: 'USD', low: 2.42, high: 2.66, basis: 'quote' });
    expect(range.overseas.unit_krw).toEqual({ low: 3200, high: 3520 });
    expect(range.overseas.total_krw).toEqual({ low: 3200 * 1000, high: 3520 * 1000 });
    expect(range.moq).toBe(GOLF_TEE_MOQ_PACKAGES);
    expect(range.domestic).toEqual({ status: 'insufficient', currency: 'KRW', reason: '국내 기준은 상세견적이 필요한 사양입니다.' });
  });

  it('uses listings of the material only when there is no quote, and needs five of them from three suppliers', () => {
    const plastic = [4, 4.5, 5, 5.5, 6].map((price, index) => row({ product_type: 'plastic_tee', price_min: price, price_max: price, supplier_name: `P${index}` }));

    expect(calculateTeeRange('plastic', plastic).overseas).toMatchObject({ status: 'ok', basis: 'listing' });
    expect(calculateTeeRange('plastic', plastic.slice(0, 4)).overseas.status).toBe('insufficient');
    // bamboo rows never price a plastic tee, and the other way round
    expect(calculateTeeRange('plastic', [...QUOTES, ...BAMBOO_LISTINGS]).overseas.status).toBe('insufficient');
  });

  it('does not decide an unknown material: the staff quote it', () => {
    expect(calculateTeeRange('unknown', [...QUOTES]).overseas).toEqual({ status: 'insufficient', currency: 'USD', reason: '이 사양은 상세견적이 필요합니다. 담당자가 확인해 드립니다.' });
  });
});

describe('POST /api/estimate-preview/golf-tee-range', () => {
  const range = jest.mocked(getTeeRange);

  beforeEach(() => {
    range.mockReset().mockResolvedValue(calculateTeeRange('bamboo', QUOTES));
  });

  it('answers the range of one package and of the minimum order, without what it rests on', async () => {
    const res = await request(createApp()).post('/api/estimate-preview/golf-tee-range').send({ material: 'bamboo', price: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spec: { material: 'bamboo' }, unit: 'package', tees_per_package: 50, moq: 1000, notice: RANGE_NOTICE });
    expect(res.body.overseas).toEqual({ status: 'ok', currency: 'USD', low: 2.42, high: 2.66, unit_krw: { low: 3200, high: 3520 }, total_krw: { low: 3200000, high: 3520000 } });
    expect(JSON.stringify(res.body)).not.toMatch(/basis|quote|supplier|example.com/);
    expect(range).toHaveBeenCalledWith('bamboo');
  });

  it('refuses a material that is not one of the form, without reading the database', async () => {
    for (const body of [{}, { material: 'metal' }, { material: 3 }]) {
      expect((await request(createApp()).post('/api/estimate-preview/golf-tee-range').send(body)).status).toBe(400);
    }
    expect(range).not.toHaveBeenCalled();
  });

  it('answers 500 without the details when the database fails', async () => {
    range.mockRejectedValue(new Error('connection refused'));

    const res = await request(createApp()).post('/api/estimate-preview/golf-tee-range').send({ material: 'bamboo' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});

// TEMPORARY (2026-11-19): a wood tee without evidence of its own is 0.8 times the bamboo tee as shown.
describe('the wood tee priced from the bamboo tee', () => {
  it('is 0.8 times the bamboo range, per package and for the minimum order', () => {
    const wood = calculateTeeRange('wood', QUOTES).overseas;

    // bamboo USD 2.42 - 2.66 -> 1.94 - 2.13
    expect(wood).toMatchObject({ status: 'ok', low: 1.94, high: 2.13, basis: 'derived' });
    expect(wood.unit_krw).toEqual({ low: 2570, high: 2820 });
    expect(wood.total_krw).toEqual({ low: 2570000, high: 2820000 });
  });

  it('has no range when the bamboo tee has none, and uses its own listings once there are enough', () => {
    expect(calculateTeeRange('wood', []).overseas.status).toBe('insufficient');
    const own = [1, 1.2, 1.4, 1.6, 1.8].map((price, index) => row({ product_type: 'wood_tee', price_min: price, price_max: price, supplier_name: `W${index}` }));

    expect(calculateTeeRange('wood', [...QUOTES, ...own]).overseas).toMatchObject({ status: 'ok', basis: 'listing' });
  });
});
