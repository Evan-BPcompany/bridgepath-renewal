import {
  adjustmentFactor,
  calculateGolfShoeRange,
  calculateRegionRange,
  freshness,
  getGolfShoeRange,
  loadGolfShoeEvidence,
  similarity,
  weightedPercentile,
  type EvidenceItem,
  type GolfShoeSpec
} from '../services/priceRangeService';
import { MIN_LISTINGS, MIN_SIMILARITY } from '../config/priceRangeRules';
import { INSUFFICIENT_REASON, golfShoeMoq } from '../services/priceRangeService';

const NOW = new Date('2026-11-17T00:00:00Z');
// The upper is unknown, so the temporary adjustment factors (see the last describe) are all 1 and the ranges below are the plain ones of the listings.
const SPEC: GolfShoeSpec = { outsole: 'spikeless', closure: 'lace', upper_material: 'unknown' };
// A shoe that the rows of the tests match in every part.
const EXACT: GolfShoeSpec = { outsole: 'spikeless', closure: 'lace', upper_material: 'microfiber' };

const item = (extra: Partial<EvidenceItem> = {}): EvidenceItem => ({
  region: 'overseas',
  price_kind: 'listing',
  price_min: 24,
  price_max: 24,
  currency: 'USD',
  upper_material: 'microfiber',
  outsole: 'spikeless',
  closure: 'lace',
  supplier_name: 'Supplier A',
  supplier_type: 'unknown',
  source_url: 'https://example.com/a',
  source_title: 'Golf shoe A',
  collected_at: '2026-11-17',
  ...extra
});

// Six listings that match the shoe exactly, from six suppliers, at USD 20, 22, ..., 30.
const SIX = [20, 22, 24, 26, 28, 30].map((price, index) =>
  item({ price_min: price, price_max: price, supplier_name: `Supplier ${index}`, source_title: `Golf shoe ${index}` })
);

describe('similarity', () => {
  it('is 1 for a fresh row that matches every part', () => {
    expect(similarity(EXACT, item(), NOW)).toBeCloseTo(1, 5);
  });

  it('counts a part that is unknown on either side as half, and a different part as nothing', () => {
    expect(similarity(EXACT, item({ outsole: null }), NOW)).toBeCloseTo(1 - 0.4 * 0.5, 5);
    expect(similarity({ ...EXACT, closure: 'unknown' }, item(), NOW)).toBeCloseTo(1 - 0.3 * 0.5, 5);
    expect(similarity(EXACT, item({ outsole: 'spike' }), NOW)).toBeCloseTo(1 - 0.4, 5);
  });

  it('counts a hybrid sole as half a match to a spike or a spikeless sole', () => {
    expect(similarity({ ...EXACT, outsole: 'hybrid' }, item(), NOW)).toBeCloseTo(1 - 0.4 * 0.5, 5);
  });

  it('lowers the score of an old row: 180 days is fresh, a year is half, older is a fifth', () => {
    expect(freshness('2026-05-21', NOW)).toBe(1); // 180 days
    expect(freshness('2026-05-20', NOW)).toBe(0.5); // 181 days
    expect(freshness('2025-11-17', NOW)).toBe(0.5); // 365 days
    expect(freshness('2025-11-16', NOW)).toBe(0.2);
  });
});

describe('weightedPercentile', () => {
  it('takes the value at which the weight reaches the share', () => {
    const points = [{ value: 10, weight: 1 }, { value: 20, weight: 1 }, { value: 30, weight: 1 }, { value: 40, weight: 1 }, { value: 50, weight: 1 }];

    expect(weightedPercentile(points, 0.2)).toBe(10);
    expect(weightedPercentile(points, 0.5)).toBe(30);
    expect(weightedPercentile(points, 0.8)).toBe(40);
  });

  it('is not moved a row up by the rounding of the weights (0.9 three times is 2.7000000000000006)', () => {
    const points = [10, 20, 30, 40, 50, 60].map(value => ({ value, weight: 0.9 }));

    expect(weightedPercentile(points, 0.5)).toBe(30);
  });

  it('moves toward a heavy row', () => {
    const points = [{ value: 10, weight: 1 }, { value: 20, weight: 8 }, { value: 30, weight: 1 }];

    expect(weightedPercentile(points, 0.2)).toBe(20);
    expect(weightedPercentile(points, 0.8)).toBe(20);
  });
});

describe('calculateRegionRange: listings', () => {
  it('makes a range from alike listings: the 20th to 80th percentile with the company margin, rounded', () => {
    const range = calculateRegionRange('overseas', SPEC, SIX, NOW);

    expect(range.status).toBe('ok');
    expect(range.basis).toBe('listing');
    // 22 / 24 / 28 are the 20th / 50th / 80th percentile; x 1.1 = 24.2 / 26.4 / 30.8
    expect([range.low, range.mid, range.high]).toEqual([24.2, 26.4, 30.8]);
    expect(range.evidence_count).toBe(6);
    expect(range.supplier_count).toBe(6);
    // listing prices are a reference: six rows are not enough for "medium"
    expect(range.confidence).toBe('low');
    expect([range.krw_low, range.krw_high]).toEqual([32000, 40800]);
    expect(range.references).toHaveLength(5);
    expect(range.references[0]).toMatchObject({ kind: 'listing', similarity: 0.9, currency: 'USD' });
  });

  it('is "medium" with ten alike listings in a narrow range', () => {
    const ten = Array.from({ length: 10 }, (_, index) => item({ price_min: 24 + index * 0.2, price_max: 24 + index * 0.2, supplier_name: `S${index}`, source_title: `T${index}` }));

    expect(calculateRegionRange('overseas', SPEC, ten, NOW).confidence).toBe('medium');
  });

  it('says that the spec needs the staff when there are too few alike listings, without telling how many were found', () => {
    const range = calculateRegionRange('overseas', SPEC, SIX.slice(0, MIN_LISTINGS - 1), NOW);

    expect(range.status).toBe('insufficient');
    expect(range.low).toBeUndefined();
    expect(range.reason).toBe(INSUFFICIENT_REASON.overseas);
    expect(range.reason).not.toMatch(/d+건|d+곳/);
    expect(range.evidence_count).toBe(4);
  });

  it('says "cannot quote" when the rows come from fewer than three suppliers', () => {
    const same = SIX.map((row, index) => ({ ...row, supplier_name: index % 2 === 0 ? 'Only A' : 'Only B' }));

    const range = calculateRegionRange('overseas', SPEC, same, NOW);

    expect(range.status).toBe('insufficient');
    expect(range.supplier_count).toBe(2);
  });

  it('leaves out a row that is not alike enough (a spike dial shoe against a spikeless lace shoe)', () => {
    const far = SIX.map(row => ({ ...row, outsole: 'spike', closure: 'dial', upper_material: 'leather' }));

    expect(similarity(SPEC, far[0], NOW)).toBeLessThan(MIN_SIMILARITY);
    expect(calculateRegionRange('overseas', SPEC, far, NOW).evidence_count).toBe(0);
  });

  it('leaves out a listing far from the others (USD 153 among USD 20-30) and does not show it as a source', () => {
    const outlier = item({ price_min: 153.15, price_max: 153.15, supplier_name: 'Outlier Co', source_title: 'Far away' });

    const range = calculateRegionRange('overseas', SPEC, [...SIX, outlier], NOW);

    expect(range.evidence_count).toBe(6);
    expect(range.high).toBe(30.8);
    expect(range.references.map(reference => reference.title)).not.toContain('Far away');
  });

  it('counts a trading company less than a factory', () => {
    const mixed = [
      item({ price_min: 20, price_max: 20, supplier_name: 'T1', source_title: 'a', supplier_type: 'trading' }),
      item({ price_min: 20, price_max: 20, supplier_name: 'T2', source_title: 'b', supplier_type: 'trading' }),
      item({ price_min: 30, price_max: 30, supplier_name: 'F1', source_title: 'c', supplier_type: 'factory' }),
      item({ price_min: 30, price_max: 30, supplier_name: 'F2', source_title: 'd', supplier_type: 'factory' }),
      item({ price_min: 30, price_max: 30, supplier_name: 'F3', source_title: 'e', supplier_type: 'factory' })
    ];

    // weights 0.8 x 2 at 20 and 1 x 3 at 30: the 20th percentile is still 20, the median is 30
    const range = calculateRegionRange('overseas', SPEC, mixed, NOW);
    expect(range.mid).toBe(33);
  });
});

describe('calculateRegionRange: real quotes and retail prices', () => {
  const quote = (extra: Partial<EvidenceItem> = {}): EvidenceItem =>
    item({ price_kind: 'quote', price_min: 25, price_max: 25, supplier_type: 'factory', supplier_name: 'Factory Q', source_url: null, source_title: 'Quote 2026-11', ...extra });

  it('rests on a real quote alone when one is alike enough, even with listings at other prices', () => {
    const range = calculateRegionRange('overseas', SPEC, [...SIX, quote()], NOW);

    expect(range.basis).toBe('quote');
    expect(range.evidence_count).toBe(1);
    expect(range.mid).toBeCloseTo(27.5, 5); // 25 x 1.1
    // one quote is a point: the range is plus and minus 10 %
    expect(range.low as number).toBeLessThan(range.mid as number);
    expect(range.high as number).toBeGreaterThan(range.mid as number);
    expect(range.confidence).toBe('medium');
  });

  it('is "high" with two real quotes', () => {
    const range = calculateRegionRange('overseas', SPEC, [quote(), quote({ price_min: 27, price_max: 27, source_title: 'Quote 2' })], NOW);

    expect(range.confidence).toBe('high');
  });

  it('does not let a quote that is not alike enough stand alone', () => {
    const far = quote({ outsole: 'spike', closure: 'dial' });

    const range = calculateRegionRange('overseas', SPEC, [...SIX, far], NOW);

    expect(range.basis).toBe('listing');
    expect(range.evidence_count).toBe(6);
  });

  it('keeps retail prices out of the range and lists them as references of the market', () => {
    const retail = item({ price_kind: 'retail', price_min: 99, price_max: 99, source_title: 'Shop price' });

    const range = calculateRegionRange('overseas', SPEC, [...SIX, retail], NOW);

    expect(range.high).toBe(30.8);
    expect(range.retail_references).toEqual([expect.objectContaining({ kind: 'retail', title: 'Shop price', price_min: 99 })]);
  });

  it('has no range from retail prices alone', () => {
    const retail = Array.from({ length: 6 }, (_, index) => item({ price_kind: 'retail', supplier_name: `Shop ${index}`, source_title: `R${index}` }));

    expect(calculateRegionRange('overseas', SPEC, retail, NOW).status).toBe('insufficient');
  });
});

describe('calculateGolfShoeRange', () => {
  it('keeps the regions apart: overseas rows in USD, domestic rows in KRW, other currencies unused', () => {
    const domestic = Array.from({ length: 5 }, (_, index) =>
      item({ region: 'domestic', currency: 'KRW', price_min: 30000 + index * 1000, price_max: 30000 + index * 1000, supplier_name: `D${index}`, source_title: `D${index}` })
    );
    const yuan = item({ currency: 'CNY', price_min: 1, price_max: 1, source_title: 'yuan' });

    const range = calculateGolfShoeRange(SPEC, [...SIX, ...domestic, yuan], NOW);

    expect(range.overseas.currency).toBe('USD');
    expect(range.overseas.evidence_count).toBe(6);
    expect(range.domestic.currency).toBe('KRW');
    expect(range.domestic.status).toBe('ok');
    expect(range.domestic.mid).toBe(35200); // the median of 30,000 to 34,000 is 32,000; x 1.1
  });

  it('says "cannot quote" for both regions when there is no evidence at all: no row, no range', () => {
    const range = calculateGolfShoeRange(SPEC, [], NOW);

    expect(range.overseas.status).toBe('insufficient');
    expect(range.domestic.status).toBe('insufficient');
    expect(range.overseas.references).toEqual([]);
  });
});

describe('loadGolfShoeEvidence and getGolfShoeRange', () => {
  const fakeDb = (rows: unknown[]) => {
    const calls: string[] = [];
    return { db: { query: async (sql: string) => { calls.push(sql.replace(/\s+/g, ' ')); return { rows }; } }, calls };
  };

  it('reads approved rows only', async () => {
    const { db, calls } = fakeDb([]);

    await loadGolfShoeEvidence(db);

    expect(calls[0]).toContain("status = 'approved'");
    expect(calls[0]).toContain("category = 'shoes'");
  });

  it('makes the range from the rows of the database', async () => {
    const { db } = fakeDb(SIX);

    const range = await getGolfShoeRange(SPEC, db, NOW);

    expect(range.overseas.status).toBe('ok');
    expect(range.overseas.mid).toBe(26.4);
  });
});

// The temporary adjustment factors (2026-11-17, config/priceRangeRules.ts): the listings say little about the upper, the outsole and the closure,
// so their range is multiplied by the factors of the three parts. A real quote is not adjusted.
describe('the temporary adjustment of the range by the shoe', () => {
  // rows that name no upper, outsole or closure, as most of the real ones do
  const NAMELESS = SIX.map(row => ({ ...row, upper_material: null, outsole: null, closure: null }));
  const rangeFor = (spec: GolfShoeSpec, rows: EvidenceItem[] = NAMELESS) => calculateRegionRange('overseas', spec, rows, NOW);
  const PLAIN = { outsole: 'unknown', closure: 'unknown', upper_material: 'unknown' };

  it('is 1 for a shoe of which nothing is known, so the range is the plain one of the listings', () => {
    expect(adjustmentFactor(PLAIN)).toBe(1);
    expect(rangeFor(PLAIN).mid).toBe(26.4); // 24 x 1.1
  });

  it('makes a grain shoe dearer and a microfiber shoe cheaper than the middle, by the factors of the material', () => {
    const grain = rangeFor({ ...PLAIN, upper_material: 'leather' });
    const microfiber = rangeFor({ ...PLAIN, upper_material: 'microfiber' });
    const action = rangeFor({ ...PLAIN, upper_material: 'synthetic' });

    expect(grain.mid).toBeCloseTo(24 * 1.25 * 1.1, 1);
    expect(microfiber.mid).toBeCloseTo(24 * 0.85 * 1.1, 1);
    // microfiber is the cheapest of the leathers, as the owner said of the market
    expect(microfiber.mid as number).toBeLessThan(action.mid as number);
    expect(action.mid as number).toBeLessThan(grain.mid as number);
    expect(grain.low as number).toBeGreaterThan(microfiber.low as number);
    expect(grain.high as number).toBeGreaterThan(microfiber.high as number);
  });

  it('has the material factors of the owner: grain 1.25, action leather 1.05 (raised from 0.9 on 2026-11-17), microfiber 0.85', () => {
    expect(adjustmentFactor({ ...PLAIN, upper_material: 'leather' })).toBe(1.25);
    expect(adjustmentFactor({ ...PLAIN, upper_material: 'synthetic' })).toBe(1.05);
    expect(adjustmentFactor({ ...PLAIN, upper_material: 'microfiber' })).toBe(0.85);
  });

  it('adds the cost of a dial and of spikes, and multiplies the three parts together', () => {
    expect(adjustmentFactor({ ...PLAIN, closure: 'dial' })).toBe(1.15);
    expect(adjustmentFactor({ ...PLAIN, outsole: 'spike' })).toBe(1.14);
    expect(adjustmentFactor({ outsole: 'spike', closure: 'dial', upper_material: 'leather' })).toBeCloseTo(1.14 * 1.15 * 1.25, 5);
    expect(adjustmentFactor({ outsole: 'x', closure: 'y', upper_material: 'z' })).toBe(1);
    expect(rangeFor({ ...PLAIN, closure: 'dial' }).mid as number).toBeGreaterThan(rangeFor(PLAIN).mid as number);
  });

  it('measures the outsole from the spikeless sole and raises the spike by the public FOB prices (1.14), the hybrid half way', () => {
    expect(adjustmentFactor({ ...PLAIN, outsole: 'spikeless' })).toBe(1);
    expect(adjustmentFactor({ ...PLAIN, outsole: 'hybrid' })).toBe(1.07);
    // the middles of the public prices of men's golf shoes: spikes 28.5, spikeless 25.0
    expect(28.5 / 25.0).toBeCloseTo(1.14, 2);

    const spike = rangeFor({ ...PLAIN, outsole: 'spike' });
    const spikeless = rangeFor({ ...PLAIN, outsole: 'spikeless' });
    expect(spike.mid as number / (spikeless.mid as number)).toBeCloseTo(1.14, 1);
    expect(spike.low as number).toBeGreaterThan(spikeless.low as number);
  });

  it('does not adjust a real quote: it is the price of its own shoe', () => {
    const quote = item({ price_kind: 'quote', price_min: 25, price_max: 25, supplier_type: 'factory', supplier_name: 'Factory Q', source_url: null, source_title: 'Quote' });

    const grain = rangeFor({ ...EXACT, upper_material: 'leather' }, [quote]);
    const microfiber = rangeFor(EXACT, [quote]);

    expect(grain.basis).toBe('quote');
    expect(grain.mid).toBe(microfiber.mid);
  });
});

// The minimum order shown with the range (the owner, 2026-11-17): 800 pairs with spikes or a dial closure, 300 pairs for every other shoe.
describe('golfShoeMoq', () => {
  const PLAIN = { outsole: 'unknown', closure: 'unknown', upper_material: 'unknown' };

  it('is 800 pairs when the shoe has spikes, or a dial closure (BOA and the like), or both', () => {
    expect(golfShoeMoq({ ...PLAIN, outsole: 'spike' })).toBe(800);
    expect(golfShoeMoq({ ...PLAIN, closure: 'dial' })).toBe(800);
    expect(golfShoeMoq({ outsole: 'spike', closure: 'dial', upper_material: 'leather' })).toBe(800);
  });

  it('is 300 pairs for every other shoe, the unknown ones and the hybrid sole included', () => {
    expect(golfShoeMoq(PLAIN)).toBe(300);
    expect(golfShoeMoq({ outsole: 'spikeless', closure: 'lace', upper_material: 'leather' })).toBe(300);
    expect(golfShoeMoq({ outsole: 'hybrid', closure: 'strap', upper_material: 'mesh' })).toBe(300);
    expect(golfShoeMoq({ outsole: 'spikeless', closure: 'slip_on', upper_material: 'unknown' })).toBe(300);
  });
});
