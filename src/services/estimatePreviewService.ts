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
