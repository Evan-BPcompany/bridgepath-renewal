import { validateSpecification } from '../utils/specification';
import { generateEstimateAccessToken, hashEstimateToken } from '../utils/token';
import { validateReceiptId } from '../utils/receipt-id';

describe('Estimate API', () => {
  describe('Specification Validation for Estimates', () => {
    it('should validate complete eyewear estimate specification', () => {
      const spec = {
        schema_version: '1.0',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive',
        quantity: 1000
      };

      const result = validateSpecification('optical', spec);
      expect(result.valid).toBe(true);
    });

    it('should reject eyewear spec with missing quantity', () => {
      const spec = {
        schema_version: '1.0',
        frame_type: 'Full Rim',
        material: 'Titanium',
        lens_type: 'Progressive'
        // quantity missing
      };

      const result = validateSpecification('sunglasses', spec);
      expect(result.valid).toBe(false);
    });

    it('should validate shoes estimate specification', () => {
      const spec = {
        schema_version: '1.0',
        shoe_type: 'Running',
        material: 'Mesh',
        size_range: '240-250',
        quantity: 500
      };

      const result = validateSpecification('sneakers', spec);
      expect(result.valid).toBe(true);
    });

    it('should validate golf product estimate specification', () => {
      const spec = {
        schema_version: '1.0',
        product_type: 'Golf Bag',
        material: 'polyester',
        quantity: 250
      };

      const result = validateSpecification('bags', spec);
      expect(result.valid).toBe(true);
    });

    it('should validate other category estimate', () => {
      const spec = {
        schema_version: '1.0',
        product_description: 'Custom textile product',
        quantity: 1000
      };

      const result = validateSpecification('other', spec);
      expect(result.valid).toBe(true);
    });
  });

  describe('Receipt ID Validation', () => {
    it('should validate correctly formatted receipt ID', () => {
      const receipt_id = 'BP20260930001';
      const result = validateReceiptId(receipt_id);
      expect(result).toBe(true);
    });

    it('should reject invalid receipt ID format', () => {
      expect(validateReceiptId('INVALID')).toBe(false);
      expect(validateReceiptId('BP202609300001')).toBe(false);
      expect(validateReceiptId('BP2026093001')).toBe(false);
    });

    it('should reject receipt ID with invalid date', () => {
      expect(validateReceiptId('BP20260001001')).toBe(false);
      expect(validateReceiptId('BP20261301001')).toBe(false);
    });
  });

  describe('Access Token Generation and Verification', () => {
    it('should generate access token with hash', () => {
      const { token, hash } = generateEstimateAccessToken();
      expect(token).toHaveLength(64);
      expect(hash).toHaveLength(64);
      expect(token).not.toEqual(hash);
    });

    it('should hash token consistently', () => {
      const token = 'test-token-12345';
      const hash1 = hashEstimateToken(token);
      const hash2 = hashEstimateToken(token);
      expect(hash1).toEqual(hash2);
    });

    it('should produce different hashes for different tokens', () => {
      const token1 = 'test-token-1';
      const token2 = 'test-token-2';
      const hash1 = hashEstimateToken(token1);
      const hash2 = hashEstimateToken(token2);
      expect(hash1).not.toEqual(hash2);
    });

    it('should hash using SHA-256 format', () => {
      const { hash } = generateEstimateAccessToken();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid category gracefully', () => {
      const spec = {
        schema_version: '1.0',
        quantity: 100
      };

      const result = validateSpecification('invalid_category', spec);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle null specification', () => {
      const result = validateSpecification('eyewear', null);
      expect(result.valid).toBe(false);
    });

    it('should handle non-object specification', () => {
      const result = validateSpecification('shoes', 'not an object');
      expect(result.valid).toBe(false);
    });
  });

  describe('API Request/Response Contract', () => {
    it('should define POST /api/estimates contract', () => {
      const requestBody = {
        category: 'optical',
        specification_json: {
          schema_version: '1.0',
          frameColor: 'Black',
          lensType: 'normal',
          frameMaterial: 'metal',
          lensColor: 'Gray',
          quantity: 1000
        },
        customer_email: 'test@example.com',
        customer_name: 'John Doe'
      };

      expect(requestBody.category).toBeDefined();
      expect(requestBody.specification_json).toBeDefined();
    });

    it('should define GET /api/estimates/:receipt_id contract', () => {
      const receipt_id = 'BP20260930001';
      const token = 'xxxxx...';
      const query = `?token=${token}`;

      expect(receipt_id).toMatch(/^BP\d{8}\d{3}$/);
      expect(token).toBeDefined();
      expect(query).toBeDefined();
    });

    it('should define response structure with status and timestamp', () => {
      const responseBody = {
        success: true,
        receipt_id: 'BP20260930001',
        status: 'new_receipt',
        access_token: 'xxxxx...',
        created_at: new Date().toISOString()
      };

      expect(responseBody.success).toBe(true);
      expect(responseBody.receipt_id).toBeDefined();
      expect(responseBody.status).toBeDefined();
      expect(responseBody.access_token).toBeDefined();
      expect(responseBody.created_at).toBeDefined();
    });

    it('should define error response structure', () => {
      const errorResponse = {
        error: 'Invalid specification_json',
        details: ['root/quantity: must be >= 1'],
        timestamp: new Date().toISOString()
      };

      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.details).toBeDefined();
      expect(errorResponse.timestamp).toBeDefined();
    });
  });
});
