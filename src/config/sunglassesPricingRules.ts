// Rules for the sunglasses price guidance (PRD FR-3, option A: a rule-based calculator).
//
// The unit price starts from a staff-maintained row in `base_prices` (category 'eyewear') and is
// then adjusted by the multipliers below. The multipliers are PLACEHOLDERS: replace them with
// figures from real quotes before the preview is shown to customers.

export const SUNGLASSES_CATEGORY = 'eyewear';

// Frame material chosen on the form -> the base_prices.product_variant that prices it.
// A material whose variant has no active row cannot be priced on its own (see the service).
export const MATERIAL_VARIANTS: Record<string, string> = {
  plastic: 'Plastic Frame',
  metal: 'Metal Frame',
  acetate: 'Acetate Frame',
  wood: 'Wood Frame',
  mixed: 'Premium Frame'
};

// Answers that mean "the customer does not know": priced across all variants, with a wider range.
export const UNKNOWN_VALUE = 'unknown';

export const LENS_MULTIPLIERS: Record<string, number> = {
  normal: 1.0,
  polarized: 1.25,
  mirror: 1.15,
  gradient: 1.1,
  photochromic: 1.4,
  [UNKNOWN_VALUE]: 1.0
};

// Larger orders are cheaper per unit. `minQuantity` is inclusive; keep the list sorted ascending.
export const QUANTITY_TIERS: ReadonlyArray<{ minQuantity: number; multiplier: number }> = [
  { minQuantity: 1, multiplier: 1.3 },
  { minQuantity: 100, multiplier: 1.15 },
  { minQuantity: 300, multiplier: 1.0 },
  { minQuantity: 1000, multiplier: 0.9 },
  { minQuantity: 5000, multiplier: 0.82 }
];

// The range around the estimate: +/- this share of the unit price.
export const BASE_SPREAD = 0.15;
// Added once for every answer that is unknown (material or lens).
export const UNKNOWN_SPREAD_STEP = 0.1;

// Prices are shown rounded to this many won.
export const ROUNDING_UNIT = 100;

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 1000000;
