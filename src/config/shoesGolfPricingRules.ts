// Rules for the shoe and golf tee price guidance, the same kind as the sunglasses
// (config/sunglassesPricingRules.ts): the unit price starts from a row of `base_prices` (the median of
// the factory listings, migration 020) and is then adjusted by the multipliers below. The multipliers
// are PLACEHOLDERS: replace them with the figures of real quotes before relying on them.

import { UNKNOWN_VALUE } from './sunglassesPricingRules';

// --------------------------------------------------------------------------------------------- shoes

export const SHOES_CATEGORY = 'shoes';

// The minimum order: 600 pairs. Below it no price is given and no request is accepted.
export const SHOES_MIN_QUANTITY = 600;
export const SHOES_MAX_QUANTITY = 1000000;

// The shoe type chosen on the form (its card) -> the base_prices.product_variant that prices it.
// 'other' (and anything without a price) is priced across every active variant: "it depends".
export const SHOE_TYPE_VARIANTS: Record<string, string> = {
  sneakers: 'Sneakers',
  heels: 'Heels',
  mens: 'Mens Dress',
  boots: 'Boots',
  sandals: 'Sandals'
};
export const SHOE_TYPES = [...Object.keys(SHOE_TYPE_VARIANTS), 'other'];

export const SHOE_MATERIAL_MULTIPLIERS: Record<string, number> = {
  leather: 1.25,
  canvas: 0.9,
  mesh: 0.95,
  synthetic: 0.9,
  rubber: 0.85,
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
