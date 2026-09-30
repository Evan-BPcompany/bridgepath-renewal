import { validateSpecification } from '../utils/specification';

describe('Specification Validation', () => {
  describe('Eyewear category', () => {
    it('should validate valid eyewear specification', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 100
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject eyewear spec with missing required field', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        // missing lens_type
        quantity: 100
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should reject eyewear spec with empty string field', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: '',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 100
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject eyewear spec with invalid quantity', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 0
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('Shoes category', () => {
    it('should validate valid shoes specification with required fields only', () => {
      const spec = {
        schema_version: '1.0',
        category: 'shoes',
        shoe_type: 'Running',
        material: 'Mesh',
        size_range: '6-12',
        quantity: 500
      };

      const result = validateSpecification('shoes', spec);
      expect(result.valid).toBe(true);
    });

    it('should validate shoes spec with optional special_requirements', () => {
      const spec = {
        schema_version: '1.0',
        category: 'shoes',
        shoe_type: 'Running',
        material: 'Mesh',
        size_range: '6-12',
        quantity: 500,
        special_requirements: 'Waterproof'
      };

      const result = validateSpecification('shoes', spec);
      expect(result.valid).toBe(true);
    });

    it('should reject shoes spec with missing size_range', () => {
      const spec = {
        schema_version: '1.0',
        category: 'shoes',
        shoe_type: 'Running',
        material: 'Mesh',
        // missing size_range
        quantity: 500
      };

      const result = validateSpecification('shoes', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('Golf products category', () => {
    it('should validate valid golf product specification', () => {
      const spec = {
        schema_version: '1.0',
        category: 'golf_products',
        product_type: 'Driver',
        material: 'Carbon Fiber',
        quantity: 250
      };

      const result = validateSpecification('golf_products', spec);
      expect(result.valid).toBe(true);
    });

    it('should validate golf product with optional customization', () => {
      const spec = {
        schema_version: '1.0',
        category: 'golf_products',
        product_type: 'Driver',
        material: 'Carbon Fiber',
        quantity: 250,
        customization: 'Custom grip'
      };

      const result = validateSpecification('golf_products', spec);
      expect(result.valid).toBe(true);
    });

    it('should reject golf product with missing material', () => {
      const spec = {
        schema_version: '1.0',
        category: 'golf_products',
        product_type: 'Driver',
        // missing material
        quantity: 250
      };

      const result = validateSpecification('golf_products', spec);
      expect(result.valid).toBe(false);
    });
  });

  describe('Other category', () => {
    it('should validate valid other product specification', () => {
      const spec = {
        schema_version: '1.0',
        category: 'other',
        product_description: 'Custom textile product',
        quantity: 1000
      };

      const result = validateSpecification('other', spec);
      expect(result.valid).toBe(true);
    });

    it('should validate other product with optional special_requirements', () => {
      const spec = {
        schema_version: '1.0',
        category: 'other',
        product_description: 'Custom textile product',
        quantity: 1000,
        special_requirements: 'Eco-friendly materials'
      };

      const result = validateSpecification('other', spec);
      expect(result.valid).toBe(true);
    });

    it('should reject other product with missing product_description', () => {
      const spec = {
        schema_version: '1.0',
        category: 'other',
        // missing product_description
        quantity: 1000
      };

      const result = validateSpecification('other', spec);
      expect(result.valid).toBe(false);
    });
  });

  describe('Category mapping', () => {
    it('should accept optical as eyewear detail category', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 100
      };

      const result = validateSpecification('optical', spec);
      expect(result.valid).toBe(true);
    });

    it('should accept sunglasses as eyewear detail category', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 100
      };

      const result = validateSpecification('sunglasses', spec);
      expect(result.valid).toBe(true);
    });

    it('should accept sneakers as shoes detail category', () => {
      const spec = {
        schema_version: '1.0',
        category: 'shoes',
        shoe_type: 'Running',
        material: 'Mesh',
        size_range: '6-12',
        quantity: 500
      };

      const result = validateSpecification('sneakers', spec);
      expect(result.valid).toBe(true);
    });

    it('should accept bags as golf_products detail category', () => {
      const spec = {
        schema_version: '1.0',
        category: 'golf_products',
        product_type: 'Driver',
        material: 'Carbon Fiber',
        quantity: 250
      };

      const result = validateSpecification('bags', spec);
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid category', () => {
    it('should reject unknown category', () => {
      const spec = {
        schema_version: '1.0',
        category: 'invalid_category',
        quantity: 100
      };

      const result = validateSpecification('invalid_category', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('Unknown category');
    });

    it('should reject null specification', () => {
      const result = validateSpecification('eyewear', null);
      expect(result.valid).toBe(false);
    });

    it('should reject non-object specification', () => {
      const result = validateSpecification('shoes', 'not an object');
      expect(result.valid).toBe(false);
    });
  });

  describe('Quantity constraints', () => {
    it('should reject quantity below minimum (0)', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 0
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
    });

    it('should reject quantity above maximum', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 1000001
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
    });

    it('should accept quantity at maximum boundary', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 1000000
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(true);
    });

    it('should accept quantity at minimum boundary', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 1
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(true);
    });
  });

  describe('Wrong type validation', () => {
    it('should reject non-number quantity', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 'one hundred'
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
    });

    it('should reject non-string frame_type', () => {
      const spec = {
        schema_version: '1.0',
        category: 'eyewear',
        frame_type: 123,
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 100
      };

      const result = validateSpecification('eyewear', spec);
      expect(result.valid).toBe(false);
    });
  });
});
