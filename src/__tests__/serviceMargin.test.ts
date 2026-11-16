// The margin of the company (10 %) is in the unit price of every price range that the guidance shows: sunglasses, shoes and
// golf tees. The database keeps the factory prices.
import { SERVICE_MARGIN_RATE, withServiceMargin } from '../config/serviceMargin';

type Service = typeof import('../services/estimatePreviewService');

// The service loaded with a margin of its own, so a range with the real margin can be compared with one without.
function loadService(rate: number): Service {
  let loaded: Service | undefined;
  jest.isolateModules(() => {
    jest.doMock('../config/database', () => ({ getPool: jest.fn() }));
    jest.doMock('../config/serviceMargin', () => ({ SERVICE_MARGIN_RATE: rate, withServiceMargin: (value: number) => value * (1 + rate) }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    loaded = require('../services/estimatePreviewService') as Service;
  });
  return loaded as Service;
}

const SUNGLASSES_ROWS = [
  { product_variant: 'Plastic Frame', base_price: 15000 },
  { product_variant: 'Metal Frame', base_price: 25000 }
];
const SHOE_ROWS = [
  { product_variant: 'Sneakers', base_price: 14000 },
  { product_variant: 'Boots', base_price: 30000 }
];
const TEE_ROWS = [{ product_variant: 'Bamboo Tee', base_price: 50.4 }];

describe('the margin of the company in the price guidance', () => {
  it('is 10 %, and only multiplies', () => {
    expect(SERVICE_MARGIN_RATE).toBe(0.1);
    expect(withServiceMargin(1000)).toBeCloseTo(1100, 6);
  });

  it('puts 10 % on the sunglasses: 15,000 won plastic frame, 500 pieces, -/+15 % range', () => {
    const result: any = loadService(SERVICE_MARGIN_RATE).calculateSunglassesPreview({ material: 'plastic', lens_type: 'normal', quantity: 500 }, SUNGLASSES_ROWS);

    // 15000 x 0.85 = 12750 -> x 1.1 = 14025 -> 14,000; 15000 x 1.15 = 17250 -> x 1.1 = 18975 -> 19,000
    expect(result.unit_price).toEqual({ min: 14000, max: 19000 });
    expect(result.total_price).toEqual({ min: 7000000, max: 9500000 });
  });

  it('puts the same 10 % on the shoes, the golf tees and the sunglasses (each range is about 1.1 times the one without a margin)', () => {
    const plain = loadService(0);
    const margin = loadService(SERVICE_MARGIN_RATE);
    const pairs: Array<[any, any, number]> = [
      [plain.calculateSunglassesPreview({ material: 'metal', lens_type: 'polarized', quantity: 1000 }, SUNGLASSES_ROWS), margin.calculateSunglassesPreview({ material: 'metal', lens_type: 'polarized', quantity: 1000 }, SUNGLASSES_ROWS), 100],
      [plain.calculateShoesPreview({ shoe_type: 'sneakers', material: 'leather', quantity: 600 }, SHOE_ROWS), margin.calculateShoesPreview({ shoe_type: 'sneakers', material: 'leather', quantity: 600 }, SHOE_ROWS), 100],
      [plain.calculateGolfTeePreview({ material: 'bamboo', quantity: 1000 }, TEE_ROWS), margin.calculateGolfTeePreview({ material: 'bamboo', quantity: 1000 }, TEE_ROWS), 10]
    ];

    for (const [without, withMargin, rounding] of pairs) {
      expect(without.available).toBe(true);
      expect(withMargin.available).toBe(true);
      // each end is rounded to the unit of its product, so it can differ by half a unit
      expect(Math.abs(withMargin.unit_price.min - without.unit_price.min * 1.1)).toBeLessThanOrEqual(rounding);
      expect(Math.abs(withMargin.unit_price.max - without.unit_price.max * 1.1)).toBeLessThanOrEqual(rounding);
      expect(withMargin.unit_price.min).toBeGreaterThan(without.unit_price.min);
    }
  });

  it('keeps an answer that has no price a plain answer: no margin on "below the minimum" or "no base price"', () => {
    const service = loadService(SERVICE_MARGIN_RATE);

    expect(service.calculateShoesPreview({ shoe_type: 'sneakers', material: 'leather', quantity: 10 }, SHOE_ROWS)).toMatchObject({ available: false, reason: 'BELOW_MINIMUM' });
    expect(service.calculateGolfTeePreview({ material: 'bamboo', quantity: 1000 }, [])).toMatchObject({ available: false, reason: 'NO_BASE_PRICE' });
  });
});
