import { getPool } from '../config/database';
import {
  BASE_SPREAD,
  LENS_MULTIPLIERS,
  MATERIAL_VARIANTS,
  QUANTITY_TIERS,
  ROUNDING_UNIT,
  SUNGLASSES_CATEGORY,
  UNKNOWN_SPREAD_STEP,
  UNKNOWN_VALUE
} from '../config/sunglassesPricingRules';
import {
  GOLF_CATEGORY,
  SHOES_BASE_SPREAD,
  SHOES_CATEGORY,
  SHOES_MIN_QUANTITY,
  SHOES_ROUNDING_UNIT,
  SHOES_UNKNOWN_SPREAD_STEP,
  SHOE_MATERIAL_MULTIPLIERS,
  SHOE_QUANTITY_TIERS,
  SHOE_TYPE_VARIANTS,
  TEE_BASE_SPREAD,
  TEE_MATERIAL_VARIANTS,
  TEE_MIN_PACKAGES,
  TEE_PIECES_PER_PACKAGE,
  TEE_QUANTITY_TIERS,
  TEE_ROUNDING_UNIT,
  TEE_UNKNOWN_SPREAD_STEP
} from '../config/shoesGolfPricingRules';

export interface SunglassesPreviewInput {
  material: string;
  lens_type: string;
  quantity: number;
}

export interface BasePriceRow {
  product_variant: string;
  base_price: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export type PreviewUnavailableReason = 'NO_BASE_PRICE';

export type SunglassesPreview =
  | {
      available: true;
      currency: 'KRW';
      quantity: number;
      unit_price: PriceRange;
      total_price: PriceRange;
    }
  | { available: false; reason: PreviewUnavailableReason };

function roundToUnit(value: number): number {
  return Math.round(value / ROUNDING_UNIT) * ROUNDING_UNIT;
}

function quantityMultiplier(quantity: number): number {
  let multiplier = QUANTITY_TIERS[0].multiplier;
  for (const tier of QUANTITY_TIERS) {
    if (quantity >= tier.minQuantity) {
      multiplier = tier.multiplier;
    }
  }
  return multiplier;
}

// Pure calculation: no database, no clock. `basePrices` are the active eyewear rows.
export function calculateSunglassesPreview(
  input: SunglassesPreviewInput,
  basePrices: BasePriceRow[]
): SunglassesPreview {
  const priceByVariant = new Map(basePrices.map(row => [row.product_variant, Number(row.base_price)]));

  // A known material is priced by its own variant. An unknown one (or a material whose variant
  // has no price yet) is priced across every active variant, so the range says "it depends".
  const variant = MATERIAL_VARIANTS[input.material];
  const own = variant === undefined ? undefined : priceByVariant.get(variant);
  const materialKnown = own !== undefined;
  const basePool = own !== undefined ? [own] : Array.from(priceByVariant.values());

  if (basePool.length === 0) {
    return { available: false, reason: 'NO_BASE_PRICE' };
  }

  const lensKnown = input.lens_type !== UNKNOWN_VALUE && input.lens_type in LENS_MULTIPLIERS;
  const lensMultiplier = LENS_MULTIPLIERS[input.lens_type] ?? LENS_MULTIPLIERS[UNKNOWN_VALUE];
  const tier = quantityMultiplier(input.quantity);

  const unknownAnswers = (materialKnown ? 0 : 1) + (lensKnown ? 0 : 1);
  const spread = BASE_SPREAD + UNKNOWN_SPREAD_STEP * unknownAnswers;

  const lowUnit = Math.min(...basePool) * lensMultiplier * tier * (1 - spread);
  const highUnit = Math.max(...basePool) * lensMultiplier * tier * (1 + spread);

  const unit_price = { min: roundToUnit(lowUnit), max: roundToUnit(highUnit) };
  return {
    available: true,
    currency: 'KRW',
    quantity: input.quantity,
    unit_price,
    total_price: {
      min: unit_price.min * input.quantity,
      max: unit_price.max * input.quantity
    }
  };
}

async function loadActiveBasePrices(category: string): Promise<BasePriceRow[]> {
  const result = await getPool().query(
    `SELECT product_variant, base_price
       FROM base_prices
      WHERE category = $1 AND is_active = true`,
    [category]
  );
  return result.rows.map(row => ({
    product_variant: String(row.product_variant),
    base_price: Number(row.base_price)
  }));
}

export async function getSunglassesPreview(input: SunglassesPreviewInput): Promise<SunglassesPreview> {
  const basePrices = await loadActiveBasePrices(SUNGLASSES_CATEGORY);
  return calculateSunglassesPreview(input, basePrices);
}

// ---------------------------------------------------------------------------------------------
// Shoes and golf tees: the same arithmetic as the sunglasses, with their own rules

export type MarketPreview =
  | {
      available: true;
      currency: 'KRW';
      quantity: number;
      unit_price: PriceRange;
      total_price: PriceRange;
    }
  | { available: false; reason: PreviewUnavailableReason | 'BELOW_MINIMUM'; minimum_quantity?: number };

function tierMultiplier(tiers: ReadonlyArray<{ minQuantity: number; multiplier: number }>, quantity: number): number {
  let multiplier = tiers[0].multiplier;
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity) {
      multiplier = tier.multiplier;
    }
  }
  return multiplier;
}

function pricedRange(
  basePool: number[],
  factor: number,
  spread: number,
  rounding: number,
  quantity: number
): MarketPreview {
  const round = (value: number): number => Math.round(value / rounding) * rounding;
  const unit_price = { min: round(Math.min(...basePool) * factor * (1 - spread)), max: round(Math.max(...basePool) * factor * (1 + spread)) };
  return {
    available: true,
    currency: 'KRW',
    quantity,
    unit_price,
    total_price: { min: unit_price.min * quantity, max: unit_price.max * quantity }
  };
}

export interface ShoesPreviewInput {
  shoe_type: string;
  material: string;
  quantity: number;
}

// The price of a pair. `basePrices` are the active rows of the category 'shoes'.
export function calculateShoesPreview(input: ShoesPreviewInput, basePrices: BasePriceRow[]): MarketPreview {
  if (input.quantity < SHOES_MIN_QUANTITY) {
    return { available: false, reason: 'BELOW_MINIMUM', minimum_quantity: SHOES_MIN_QUANTITY };
  }
  const priceByVariant = new Map(basePrices.map(row => [row.product_variant, Number(row.base_price)]));
  const variant = SHOE_TYPE_VARIANTS[input.shoe_type];
  const own = variant === undefined ? undefined : priceByVariant.get(variant);
  const typeKnown = own !== undefined;
  const basePool = own !== undefined ? [own] : Array.from(priceByVariant.values());
  if (basePool.length === 0) {
    return { available: false, reason: 'NO_BASE_PRICE' };
  }

  const materialKnown = input.material !== UNKNOWN_VALUE && input.material in SHOE_MATERIAL_MULTIPLIERS;
  const materialMultiplier = SHOE_MATERIAL_MULTIPLIERS[input.material] ?? SHOE_MATERIAL_MULTIPLIERS[UNKNOWN_VALUE];
  const unknownAnswers = (typeKnown ? 0 : 1) + (materialKnown ? 0 : 1);
  const spread = SHOES_BASE_SPREAD + SHOES_UNKNOWN_SPREAD_STEP * unknownAnswers;

  return pricedRange(basePool, materialMultiplier * tierMultiplier(SHOE_QUANTITY_TIERS, input.quantity), spread, SHOES_ROUNDING_UNIT, input.quantity);
}

export async function getShoesPreview(input: ShoesPreviewInput): Promise<MarketPreview> {
  return calculateShoesPreview(input, await loadActiveBasePrices(SHOES_CATEGORY));
}

export interface GolfTeePreviewInput {
  material: string;
  quantity: number; // packages of 50 tees
}

// The price of a PACKAGE of 50 tees: the price of a tee times 50. `basePrices` are the active rows of
// the category 'golf_products' that are tees (a price per piece).
export function calculateGolfTeePreview(input: GolfTeePreviewInput, basePrices: BasePriceRow[]): MarketPreview {
  if (input.quantity < TEE_MIN_PACKAGES) {
    return { available: false, reason: 'BELOW_MINIMUM', minimum_quantity: TEE_MIN_PACKAGES };
  }
  const teeVariants = new Set(Object.values(TEE_MATERIAL_VARIANTS));
  const priceByVariant = new Map(basePrices.filter(row => teeVariants.has(row.product_variant)).map(row => [row.product_variant, Number(row.base_price)]));
  const variant = TEE_MATERIAL_VARIANTS[input.material];
  const own = variant === undefined ? undefined : priceByVariant.get(variant);
  const materialKnown = own !== undefined;
  const basePool = own !== undefined ? [own] : Array.from(priceByVariant.values());
  if (basePool.length === 0) {
    return { available: false, reason: 'NO_BASE_PRICE' };
  }

  const spread = TEE_BASE_SPREAD + (materialKnown ? 0 : TEE_UNKNOWN_SPREAD_STEP);
  const factor = TEE_PIECES_PER_PACKAGE * tierMultiplier(TEE_QUANTITY_TIERS, input.quantity);
  return pricedRange(basePool, factor, spread, TEE_ROUNDING_UNIT, input.quantity);
}

export async function getGolfTeePreview(input: GolfTeePreviewInput): Promise<MarketPreview> {
  return calculateGolfTeePreview(input, await loadActiveBasePrices(GOLF_CATEGORY));
}
