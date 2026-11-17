// Rules for the shoe and golf tee price guidance, the same kind as the sunglasses
// (config/sunglassesPricingRules.ts): the unit price starts from a row of `base_prices` (the median of
// the factory listings, migration 020) and is then adjusted by the multipliers below. The multipliers
// are PLACEHOLDERS: replace them with the figures of real quotes before relying on them.

import { UNKNOWN_VALUE } from './sunglassesPricingRules';

// --------------------------------------------------------------------------------------------- shoes

export const SHOES_CATEGORY = 'shoes';

// The minimum order: 300 pairs (the owner, 2026-11-17; it was 600). Below it no price is given and no request is accepted. The AI quote
// shows 800 pairs for a shoe with spikes or a dial closure (config/priceRangeRules.ts); that is not enforced in the request.
export const SHOES_MIN_QUANTITY = 300;
export const SHOES_MAX_QUANTITY = 1000000;

// The product of the shoes page is the golf shoe: ONE row of base_prices prices it, whatever shoe type the request carries
// (migration 022; a temporary value until a real factory quote replaces it). The shoe types below are only the categories
// that the API still accepts for a shoe request.
export const GOLF_SHOE_VARIANT = 'Golf Shoe';
export const SHOE_TYPES = ['sneakers', 'heels', 'mens', 'boots', 'sandals', 'other'];

// The upper of a golf shoe (the form's "주요 재질"): leather is grain (natural leather), synthetic is action leather
// (synthetic leather), microfiber is the usual one and, in the market, cheaper than action leather (the owner, 2026-11-17),
// so it is the lowest of the leathers. These multipliers are assumptions until real quotes come in; the outsole (spike,
// spikeless, hybrid) is asked for the request and does not change the range yet.
export const SHOE_MATERIAL_MULTIPLIERS: Record<string, number> = {
  leather: 1.25,
  microfiber: 0.85,
  mesh: 0.95,
  synthetic: 0.9,
  mixed: 1.05,
  [UNKNOWN_VALUE]: 1.0
};

// The listed prices are the middle of a range (largest tier .. minimum order), so the minimum order of
// 600 pairs sits a little above the middle. `minQuantity` is inclusive; keep the list sorted ascending.
export const SHOE_QUANTITY_TIERS: ReadonlyArray<{ minQuantity: number; multiplier: number }> = [
  { minQuantity: 1, multiplier: 1.1 },
  { minQuantity: 1000, multiplier: 1.0 },
  { minQuantity: 3000, multiplier: 0.92 },
  { minQuantity: 10000, multiplier: 0.85 }
];

export const SHOES_BASE_SPREAD = 0.2;
export const SHOES_UNKNOWN_SPREAD_STEP = 0.1;
export const SHOES_ROUNDING_UNIT = 100;

// ---------------------------------------------------------------------------------------- golf tees

// The stored category of golf requests; the product of the form is the golf tee.
export const GOLF_CATEGORY = 'golf_products';
export const GOLF_TEE_PRODUCT_TYPE = 'golf_tee';

// A package holds 50 tees; the quantity of a request is counted in packages. The minimum order is
// 1,000 packages (50,000 tees).
export const TEE_PIECES_PER_PACKAGE = 50;
export const TEE_MIN_PACKAGES = 1000;
export const TEE_MAX_PACKAGES = 1000000;

export const TEE_MATERIAL_VARIANTS: Record<string, string> = {
  wood: 'Wood Tee',
  bamboo: 'Bamboo Tee',
  plastic: 'Plastic Tee'
};

export const TEE_QUANTITY_TIERS: ReadonlyArray<{ minQuantity: number; multiplier: number }> = [
  { minQuantity: 1, multiplier: 1.0 },
  { minQuantity: 5000, multiplier: 0.95 },
  { minQuantity: 20000, multiplier: 0.9 }
];

// The tee listings rest on few suppliers, so the range is wider than for shoes.
export const TEE_BASE_SPREAD = 0.25;
export const TEE_UNKNOWN_SPREAD_STEP = 0.1;
// A package costs a few hundred won: rounded to ten won, not to a hundred.
export const TEE_ROUNDING_UNIT = 10;
