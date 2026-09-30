import Ajv, { JSONSchemaType } from 'ajv';

export type CategoryType =
  | 'eyewear' | 'shoes' | 'golf_products' | 'other'
  | 'optical' | 'sunglasses' | 'sports' | 'kids' | 'safety'
  | 'sneakers' | 'heels' | 'mens' | 'boots' | 'sandals'
  | 'bags' | 'gloves' | 'headwear' | 'accessories' | 'covers' | 'training';

export const CATEGORY_MAPPING: Record<string, string> = {
  eyewear: 'eyewear',
  optical: 'eyewear', sunglasses: 'eyewear', sports: 'eyewear', kids: 'eyewear', safety: 'eyewear',
  shoes: 'shoes',
  sneakers: 'shoes', heels: 'shoes', mens: 'shoes', boots: 'shoes', sandals: 'shoes',
  golf_products: 'golf_products',
  bags: 'golf_products', gloves: 'golf_products', headwear: 'golf_products',
  accessories: 'golf_products', covers: 'golf_products', training: 'golf_products',
  other: 'other'
};

export interface SpecificationBase {
  schema_version: string;
  category: CategoryType;
}

export interface EyewearSpecification extends SpecificationBase {
  category: 'eyewear';
  frame_type: string;
  material: string;
  lens_type: string;
  quantity: number;
}

export interface ShoesSpecification extends SpecificationBase {
  category: 'shoes';
  shoe_type: string;
  material: string;
  size_range: string;
  quantity: number;
  special_requirements?: string;
}

export interface GolfSpecification extends SpecificationBase {
  category: 'golf_products';
  product_type: string;
  material: string;
  quantity: number;
  customization?: string;
}

export interface OtherSpecification extends SpecificationBase {
  category: 'other';
  product_description: string;
  quantity: number;
  special_requirements?: string;
}

export type Specification =
  | EyewearSpecification
  | ShoesSpecification
  | GolfSpecification
  | OtherSpecification;

const ajv = new Ajv();

const eyewearSchema: JSONSchemaType<EyewearSpecification> = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    category: { type: 'string', const: 'eyewear' },
    frame_type: { type: 'string', minLength: 1 },
    material: { type: 'string', minLength: 1 },
    lens_type: { type: 'string', minLength: 1 },
    quantity: { type: 'number', minimum: 1, maximum: 1000000 }
  },
  required: ['schema_version', 'category', 'frame_type', 'material', 'lens_type', 'quantity'],
  additionalProperties: true
};

const shoesSchema: JSONSchemaType<ShoesSpecification> = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    category: { type: 'string', const: 'shoes' },
    shoe_type: { type: 'string', minLength: 1 },
    material: { type: 'string', minLength: 1 },
    size_range: { type: 'string', minLength: 1 },
    quantity: { type: 'number', minimum: 1, maximum: 1000000 },
    special_requirements: { type: 'string', nullable: true }
  },
  required: ['schema_version', 'category', 'shoe_type', 'material', 'size_range', 'quantity'],
  additionalProperties: true
} as any;

const golfSchema: JSONSchemaType<GolfSpecification> = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    category: { type: 'string', const: 'golf_products' },
    product_type: { type: 'string', minLength: 1 },
    material: { type: 'string', minLength: 1 },
    quantity: { type: 'number', minimum: 1, maximum: 1000000 },
    customization: { type: 'string', nullable: true }
  },
  required: ['schema_version', 'category', 'product_type', 'material', 'quantity'],
  additionalProperties: true
} as any;

const otherSchema: JSONSchemaType<OtherSpecification> = {
  type: 'object',
  properties: {
    schema_version: { type: 'string' },
    category: { type: 'string', const: 'other' },
    product_description: { type: 'string', minLength: 1 },
    quantity: { type: 'number', minimum: 1, maximum: 1000000 },
    special_requirements: { type: 'string', nullable: true }
  },
  required: ['schema_version', 'category', 'product_description', 'quantity'],
  additionalProperties: true
} as any;

const eyewearValidator = ajv.compile(eyewearSchema);
const shoesValidator = ajv.compile(shoesSchema);
const golfValidator = ajv.compile(golfSchema);
const otherValidator = ajv.compile(otherSchema);

export function validateSpecification(
  category: string,
  specification: unknown
): { valid: boolean; errors?: string[] } {
  const canonicalCategory = CATEGORY_MAPPING[category];

  if (!canonicalCategory) {
    return {
      valid: false,
      errors: [`Unknown category: ${category}`]
    };
  }

  const specWithCategory = {
    ...(specification as any),
    category: canonicalCategory
  };

  let validator;
  switch (canonicalCategory) {
    case 'eyewear':
      validator = eyewearValidator;
      break;
    case 'shoes':
      validator = shoesValidator;
      break;
    case 'golf_products':
      validator = golfValidator;
      break;
    case 'other':
      validator = otherValidator;
      break;
    default:
      return {
        valid: false,
        errors: [`Unknown canonical category: ${canonicalCategory}`]
      };
  }

  const valid = validator(specWithCategory);
  if (!valid) {
    const errors = validator.errors?.map(
      err => `${err.instancePath || 'root'}: ${err.message}`
    ) || ['Validation failed'];
    return {
      valid: false,
      errors
    };
  }

  return { valid: true };
}
