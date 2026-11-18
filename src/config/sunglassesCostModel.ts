// The sunglasses cost model (the owner's request of 2026-11-18): a SIMULATION of the manufacturing cost of one pair of sunglasses
// made in China (OEM), from its parts. It is not a factory quote and not a supplier's selling price: the base costs below are the
// service's starting values, to be corrected with real quotes. New moulds, international freight, duty and VAT are not included.
//
//   frame cost = BASE_FRAME_COST x frame multiplier
//   lens cost  = BASE_LENS_COST x (lens multiplier + the additions of the chosen lens options)
//   unit cost  = frame cost + lens cost + OTHER_COST
//   total cost = unit cost x quantity
//
// A multiplier changes its own part only: the frame multiplier never touches the lens or the other cost, and no multiplier is applied
// to the price of a finished product. Change the values here; the tests check the owner's table (USD per pair, 1,000 pairs).

export const BASE_FRAME_COST = 1.0;
export const BASE_LENS_COST = 0.6;
// Hinges and basic parts, assembly, basic packing and other basic manufacturing costs, per pair.
export const OTHER_COST = 0.6;
// The production quantity the base costs stand for.
export const BASE_QUANTITY = 1000;

// From the PC plastic frame (1.00).
export const FRAME_MULTIPLIERS = {
  pc: 1.0,
  tr90: 1.15,
  metal: 1.5,
  acetate: 2.1, // cut and polished from sheet; injected acetate is a kind of its own and is not priced here
  wood: 2.0,
  mixed: 1.6 // only when the parts are not known
} as const;

// From the plain non-polarised PC lens (1.00).
export const LENS_MULTIPLIERS = {
  pc_standard: 1.0,
  pc_polarized: 1.45,
  tac_polarized: 1.6,
  cr39_standard: 1.4,
  nylon_standard: 1.7
} as const;

// Added to the lens multiplier once each when chosen.
export const LENS_OPTION_ADDITIONS = {
  mirror: 0.1,
  gradient: 0.08,
  photochromic: 0.5
} as const;

export type Frame = keyof typeof FRAME_MULTIPLIERS;
export type Lens = keyof typeof LENS_MULTIPLIERS;
export type LensOption = keyof typeof LENS_OPTION_ADDITIONS;

export const FRAMES = Object.keys(FRAME_MULTIPLIERS) as Frame[];
export const LENSES = Object.keys(LENS_MULTIPLIERS) as Lens[];
export const LENS_OPTIONS = Object.keys(LENS_OPTION_ADDITIONS) as LensOption[];

export interface SunglassesCostInput {
  frame: Frame;
  lens: Lens;
  mirror?: boolean;
  gradient?: boolean;
  photochromic?: boolean;
  quantity?: number;
}

export interface SunglassesCost {
  frameCost: number;
  lensCost: number;
  otherCost: number;
  unitCost: number;
  quantity: number;
  totalCost: number;
  currency: 'USD';
  estimateType: 'simulation';
}

// Money is added in cents so that 1.15 + 0.96 + 0.60 is 2.71, not 2.7099999999999995.
const cents = (usd: number): number => Math.round(usd * 100);

export function calculateSunglassesCost({ frame, lens, mirror = false, gradient = false, photochromic = false, quantity = BASE_QUANTITY }: SunglassesCostInput): SunglassesCost {
  if (!Object.prototype.hasOwnProperty.call(FRAME_MULTIPLIERS, frame)) {
    throw new Error('지원하지 않는 프레임 소재');
  }
  if (!Object.prototype.hasOwnProperty.call(LENS_MULTIPLIERS, lens)) {
    throw new Error('지원하지 않는 렌즈 유형');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('생산 수량은 1 이상의 정수여야 합니다.');
  }

  let lensMultiplier = LENS_MULTIPLIERS[lens];
  if (mirror) lensMultiplier += LENS_OPTION_ADDITIONS.mirror;
  if (gradient) lensMultiplier += LENS_OPTION_ADDITIONS.gradient;
  if (photochromic) lensMultiplier += LENS_OPTION_ADDITIONS.photochromic;

  const frameCents = cents(BASE_FRAME_COST * FRAME_MULTIPLIERS[frame]);
  const lensCents = cents(BASE_LENS_COST * lensMultiplier);
  const unitCents = frameCents + lensCents + cents(OTHER_COST);

  return {
    frameCost: frameCents / 100,
    lensCost: lensCents / 100,
    otherCost: OTHER_COST,
    unitCost: unitCents / 100,
    quantity,
    totalCost: (unitCents * quantity) / 100,
    currency: 'USD',
    estimateType: 'simulation'
  };
}
