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

// What the customer's screen showed when the AI quote was started (sunglasses form): the analysis
// of the photo and the price range. It is advisory and written by the browser, so it is a record of
// what the customer saw, never a quote and never trusted: the staff work from the real
// specification and the rules. Because it must never stop a request, an ai_preview that does not fit
// this shape is dropped (stripInvalidAiPreview) instead of refusing the request.
const text = (maxLength: number) => ({ type: 'string', maxLength });
const range = {
  type: 'object',
  properties: { min: { type: 'integer', minimum: 0, maximum: 100000000000 }, max: { type: 'integer', minimum: 0, maximum: 100000000000 } },
  required: ['min', 'max'],
  additionalProperties: false
};
const textList = { type: 'array', items: text(200), maxItems: 4 };

const aiPreviewSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', const: 'customer_screen' },
    analysis: {
      type: 'object',
      properties: {
        frame_material: { type: 'string', enum: ['plastic', 'metal', 'acetate', 'wood', 'mixed', 'unknown'] },
        lens_type: { type: 'string', enum: ['normal', 'polarized', 'mirror', 'gradient', 'photochromic', 'unknown'] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
        frame_shape: text(100),
        frame_color: text(100),
        overview: text(1000),
        details: {
          type: 'object',
          properties: { frame: text(300), lens: text(300), decoration: text(300) },
          additionalProperties: false
        },
        cost_factors: textList,
        recommendations: textList
      },
      additionalProperties: false
    },
    price: {
      type: 'object',
      properties: {
        currency: { type: 'string', const: 'KRW' },
        quantity: { type: 'integer', minimum: 1, maximum: 1000000 },
        unit_price: range,
        total_price: range
      },
      required: ['currency', 'quantity', 'unit_price', 'total_price'],
      additionalProperties: false
    }
  },
  required: ['source'],
  additionalProperties: false
};

const aiPreviewValidator = ajv.compile(aiPreviewSchema);

export function stripInvalidAiPreview(specification: unknown): { specification: unknown; dropped: boolean } {
  if (!specification || typeof specification !== 'object' || Array.isArray(specification) || !('ai_preview' in specification)) {
    return { specification, dropped: false };
  }

  if (aiPreviewValidator((specification as Record<string, unknown>).ai_preview)) {
    return { specification, dropped: false };
  }

  const { ai_preview: _dropped, ...rest } = specification as Record<string, unknown>;
  return { specification: rest, dropped: true };
}
