import { USD_KRW } from '../db/migrations/020_shoes_golf_tee_base_prices';

// How a golf shoe price range is made from the approved rows of price_evidence (2026-11-17). Every number here is a choice of
// the service, not a market fact: change it here, and the tests show what moves.

export const RANGE_REGIONS = ['overseas', 'domestic'] as const;
export type RangeRegion = (typeof RANGE_REGIONS)[number];

// One currency per region: a row in another currency is not converted and not used (overseas = China, USD; domestic = KRW).
export const REGION_CURRENCY: Record<RangeRegion, 'USD' | 'KRW'> = { overseas: 'USD', domestic: 'KRW' };

// A price is shown to this step: USD to ten cents, KRW to a hundred won.
export const ROUNDING_STEP: Record<'USD' | 'KRW', number> = { USD: 0.1, KRW: 100 };

// The overseas range is also shown in won at this rate (the one of the base prices, migration 020).
export const DISPLAY_USD_KRW = USD_KRW;

// How alike a row of evidence is to the shoe of the photo: the sum of these weights times how well each part matches.
// A part that is unknown on either side counts half (it neither supports nor contradicts); "hybrid" matches a spike or spikeless sole half.
export const SIMILARITY_WEIGHTS = { outsole: 0.4, closure: 0.3, upper_material: 0.2, freshness: 0.1 } as const;
export const UNKNOWN_MATCH = 0.5;

// Below this a row is not used at all.
export const MIN_SIMILARITY = 0.5;
// A real quote must be at least this alike to stand alone.
export const MIN_QUOTE_SIMILARITY = 0.7;

// How fresh a row is by the days since it was collected: up to FRESH_DAYS 1, up to STALE_DAYS 0.5, older 0.2.
export const FRESH_DAYS = 180;
export const STALE_DAYS = 365;

// A real quote counts twice as much as a listing in the weighted percentiles; a trading company's listing counts a fifth less.
export const KIND_WEIGHT = { quote: 2, listing: 1 } as const;
export const TRADING_WEIGHT = 0.8;

// Without a real quote, a range needs this many alike listings from this many different suppliers, or the answer is "cannot quote".
export const MIN_LISTINGS = 5;
export const MIN_SUPPLIERS = 3;

// The range is the weighted 20th to 80th percentile of the prices (the middle of each row's range), the middle is the 50th.
export const LOW_PERCENTILE = 0.2;
export const HIGH_PERCENTILE = 0.8;

// A listing price more than this many times above or below the median of the alike listings is left out as an outlier.
export const OUTLIER_FACTOR = 2;

// TEMPORARY ADJUSTMENTS (2026-11-17, the owner's decision): the public listings say little about the upper, the outsole or the closure
// (only 23 of the 52 approved rows name an upper, 15 an outsole, 6 a closure), so the range of listings barely moves when the visitor
// changes one. Until real quotes show the differences, the range of LISTINGS is multiplied by the factors of the three parts. A real
// quote is not adjusted: it is the price of its own shoe. 1 is the middle of the listings; "unknown" is always 1.
// The material factors started as the ones of the earlier price guidance (grain dearest, microfiber the cheapest of the leathers); action
// leather was raised from 0.9 to 1.05 by the owner on 2026-11-17. They are a table of their own: the old guidance keeps its own. The outsole
// and closure factors are assumptions of the first version (cleat sockets and spikes, the dial and its wire cost more): replace all of them with quotes.
export const MATERIAL_ADJUSTMENT: Record<string, number> = { leather: 1.25, synthetic: 1.05, microfiber: 0.85, mesh: 0.95, mixed: 1.05, unknown: 1.0 };
// The outsole is measured from the spikeless sole (1.0) and raised for spikes (the owner, 2026-11-17: public FOB prices of men's golf shoes,
// spikes USD 26.99-29.99 (middle 28.5) against spikeless USD 22.00-28.03 (middle 25.0), a ratio of 1.14); a hybrid sole is half way.
export const OUTSOLE_ADJUSTMENT: Record<string, number> = { spike: 1.14, spikeless: 1.0, hybrid: 1.07, unknown: 1.0 };
export const CLOSURE_ADJUSTMENT: Record<string, number> = { dial: 1.15, lace: 1.0, strap: 0.98, slip_on: 0.95, mixed: 1.08, unknown: 1.0 };

// The minimum order shown with the range (the owner, 2026-11-17): 800 pairs when the shoe has spikes or a dial closure (BOA and the like),
// 300 pairs for every other shoe, the unknown ones included.
export const GOLF_SHOE_MOQ = { standard: 300, complex: 800 } as const;

// One real quote is a point: the range is that price plus and minus this.
export const SINGLE_QUOTE_SPREAD = 0.1;

// Confidence "medium" for listings needs at least this many rows and a high/low percentile ratio of at most this.
export const MEDIUM_CONFIDENCE_LISTINGS = 10;
export const MEDIUM_CONFIDENCE_SPREAD = 1.5;

// The most references (sources) and retail references returned for each region.
export const MAX_REFERENCES = 5;
export const MAX_RETAIL_REFERENCES = 3;

export const RANGE_NOTICE =
  '참고용 범위이며 확정 견적이 아닙니다. 운송비·관세·금형·로고·포장 비용은 포함하지 않았습니다. 정식 견적은 담당자가 확인한 뒤 안내드립니다.';
