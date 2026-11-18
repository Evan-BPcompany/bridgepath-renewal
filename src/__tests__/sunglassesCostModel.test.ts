import { calculateSunglassesCost, FRAMES, LENSES, type Frame, type Lens } from '../config/sunglassesCostModel';
import { simulateSunglassesCost, supplierReference, type SunglassesEvidence } from '../services/sunglassesCostService';

// The owner's table (2026-11-18): USD per pair, 1,000 pairs, no lens option.
const TABLE: Record<Frame, number[]> = {
  //       pc_standard pc_polarized tac_polarized cr39_standard nylon_standard
  pc: [2.2, 2.47, 2.56, 2.44, 2.62],
  tr90: [2.35, 2.62, 2.71, 2.59, 2.77],
  metal: [2.7, 2.97, 3.06, 2.94, 3.12],
  acetate: [3.3, 3.57, 3.66, 3.54, 3.72],
  wood: [3.2, 3.47, 3.56, 3.44, 3.62],
  mixed: [2.8, 3.07, 3.16, 3.04, 3.22]
};

describe('calculateSunglassesCost (the cost model)', () => {
  it('gives every cell of the owner table exactly', () => {
    for (const frame of FRAMES) {
      LENSES.forEach((lens: Lens, index) => {
        expect([frame, lens, calculateSunglassesCost({ frame, lens }).unitCost]).toEqual([frame, lens, TABLE[frame][index]]);
      });
    }
  });

  it('gives TR90 with a TAC polarised lens for 1,000 pairs: 1.15 + 0.96 + 0.60 = 2.71, total 2,710', () => {
    expect(calculateSunglassesCost({ frame: 'tr90', lens: 'tac_polarized', quantity: 1000 })).toEqual({
      frameCost: 1.15,
      lensCost: 0.96,
      otherCost: 0.6,
      unitCost: 2.71,
      quantity: 1000,
      totalCost: 2710,
      currency: 'USD',
      estimateType: 'simulation'
    });
  });

  it('adds the lens options to the lens multiplier only, once each', () => {
    const plain = calculateSunglassesCost({ frame: 'pc', lens: 'pc_standard' });
    const all = calculateSunglassesCost({ frame: 'pc', lens: 'pc_standard', mirror: true, gradient: true, photochromic: true });

    // 0.60 x (1.00 + 0.10 + 0.08 + 0.50) = 1.008
    expect(all.lensCost).toBe(1.01);
    expect(all.frameCost).toBe(plain.frameCost);
    expect(all.otherCost).toBe(plain.otherCost);
    expect(calculateSunglassesCost({ frame: 'pc', lens: 'pc_standard', mirror: true }).lensCost).toBe(0.66);
  });

  it('changes the frame part only with the frame, and the total is the shown unit cost times the quantity', () => {
    const acetate = calculateSunglassesCost({ frame: 'acetate', lens: 'pc_standard', quantity: 300 });

    expect(acetate.frameCost).toBe(2.1);
    expect(acetate.lensCost).toBe(0.6);
    expect(acetate.totalCost).toBe(990);
  });

  it('refuses an unknown frame or lens and a quantity that is not a whole number from 1', () => {
    expect(() => calculateSunglassesCost({ frame: 'titanium' as Frame, lens: 'pc_standard' })).toThrow('지원하지 않는 프레임 소재');
    expect(() => calculateSunglassesCost({ frame: 'pc', lens: 'glass' as Lens })).toThrow('지원하지 않는 렌즈 유형');
    expect(() => calculateSunglassesCost({ frame: 'pc', lens: 'pc_standard', quantity: 0 })).toThrow('생산 수량');
    expect(() => calculateSunglassesCost({ frame: 'pc', lens: 'pc_standard', quantity: 1.5 })).toThrow('생산 수량');
  });
});

describe('simulateSunglassesCost (what the API answers)', () => {
  const request = { frame: 'tr90' as const, lens: 'tac_polarized' as const, mirror: false, gradient: false, photochromic: false, quantity: 1000 };

  it('is one value when frame and lens are known', () => {
    const result = simulateSunglassesCost(request);

    expect(result.unconfirmed).toEqual([]);
    expect(result.unit_cost).toEqual({ low: 2.71, high: 2.71 });
    expect(result.total_cost).toEqual({ low: 2710, high: 2710 });
    expect(result.unit_krw).toEqual({ low: 3600, high: 3600 });
    expect(result.estimate_type).toBe('simulation');
  });

  it('does not decide an unknown lens: the cost spans every lens, and the lens is marked as unconfirmed', () => {
    const result = simulateSunglassesCost({ ...request, lens: 'unknown' });

    expect(result.unconfirmed).toEqual(['lens']);
    expect(result.lens_cost).toEqual({ low: 0.6, high: 1.02 });
    expect(result.unit_cost).toEqual({ low: 2.35, high: 2.77 });
    expect(result.frame_cost).toEqual({ low: 1.15, high: 1.15 });
  });

  it('spans every frame when the frame is unknown', () => {
    const result = simulateSunglassesCost({ ...request, frame: 'unknown', lens: 'unknown' });

    expect(result.unconfirmed).toEqual(['frame', 'lens']);
    expect(result.unit_cost).toEqual({ low: 2.2, high: 3.72 });
  });
});

describe('supplierReference (public prices, kept apart from the simulation)', () => {
  const row = (price: number, index: number, frame: string | null = 'plastic'): SunglassesEvidence => ({
    region: 'overseas',
    price_kind: 'listing',
    price_min: price,
    price_max: price,
    currency: 'USD',
    upper_material: null,
    outsole: null,
    closure: null,
    frame_material: frame,
    lens_type: null,
    supplier_name: `Supplier ${index}`,
    supplier_type: 'unknown',
    source_url: 'https://example.com',
    source_title: `Sunglasses ${index}`,
    collected_at: '2026-11-18'
  });

  it('uses only listings that name the same kind of frame, as listed, with no factor', () => {
    const evidence = [...[2, 2.5, 3, 3.5, 4].map((price, index) => row(price, index)), row(9, 9, 'acetate'), row(1, 10, null)];

    // PC and TR90 are both "plastic" in the evidence
    expect(supplierReference('tr90', evidence)).toEqual({ status: 'ok', low: 2, high: 3.5, unit_krw: { low: 2600, high: 4600 } });
    expect(supplierReference('pc', evidence)).toEqual(supplierReference('tr90', evidence));
  });

  it('has no reference with fewer than five listings of the frame, or for an unknown frame', () => {
    const evidence = [row(6, 0, 'acetate'), row(7, 1, 'acetate'), row(7.5, 2, 'acetate')];

    expect(supplierReference('acetate', evidence)).toEqual({ status: 'insufficient' });
    expect(supplierReference('unknown', evidence)).toEqual({ status: 'insufficient' });
  });
});

describe('a plastic frame (PC or TR90, which a photo cannot tell apart)', () => {
  it('spans PC and TR90 and marks the frame as unconfirmed', () => {
    const result = simulateSunglassesCost({ frame: 'plastic', lens: 'pc_standard', mirror: false, gradient: false, photochromic: false, quantity: 1000 });

    expect(result.frame_cost).toEqual({ low: 1, high: 1.15 });
    expect(result.unit_cost).toEqual({ low: 2.2, high: 2.35 });
    expect(result.unconfirmed).toEqual(['frame']);
  });
});
