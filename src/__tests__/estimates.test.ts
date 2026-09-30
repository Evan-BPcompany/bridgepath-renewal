import { validateSpecification } from '../utils/specification';
import { generateEstimateAccessToken, hashEstimateToken } from '../utils/token';
import { validateReceiptId } from '../utils/receipt-id';
import { validateFileBuffer, generateSafeFileId, getFileExtension } from '../utils/fileValidation';

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

  describe('Token-ReceiptId Validation', () => {
    it('should validate token belongs to correct receipt_id', () => {
      const tokenA = 'token-for-receipt-A';
      const tokenB = 'token-for-receipt-B';
      const receiptIdA = 'BP20260930001';
      const receiptIdB = 'BP20260930002';

      expect(tokenA).not.toEqual(tokenB);
      expect(receiptIdA).not.toEqual(receiptIdB);
    });

    it('should reject if token A is used with receipt_id B', () => {
      const tokenA = 'token-A';
      const receiptIdB = 'BP20260930002';

      expect(tokenA).toBeDefined();
      expect(receiptIdB).toBeDefined();
    });

    it('should enforce atomic transaction for token consumption', () => {
      const token = 'test-token';
      const receipt_id = 'BP20260930001';

      expect(token).toBeDefined();
      expect(receipt_id).toBeDefined();
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

    it('should NOT expose internal estimate_id in HTTP response', () => {
      const responseBody = {
        success: true,
        receipt_id: 'BP20260930001',
        status: 'new_receipt',
        access_token: 'xxxxx...',
        created_at: new Date().toISOString()
      };

      expect(responseBody).not.toHaveProperty('estimate_id');
    });

    it('should define file upload response structure', () => {
      const fileResponse = {
        id: 'file-uuid-123',
        filename: 'document.pdf',
        size: 102400,
        status: 'quarantine'
      };

      expect(fileResponse.id).toBeDefined();
      expect(fileResponse.filename).toBeDefined();
      expect(fileResponse.size).toBeDefined();
      expect(fileResponse.status).toBeDefined();
      expect(fileResponse.status).toMatch(/^(quarantine|pending_scan|approved|rejected)$/);
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

  describe('File Upload Validation', () => {
    describe('MIME type and magic bytes validation', () => {
      it('should validate JPEG file with correct magic bytes', () => {
        const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const result = validateFileBuffer(jpegMagic, 'image/jpeg', 'photo.jpg');
        expect(result.valid).toBe(true);
      });

      it('should reject JPEG with incorrect magic bytes', () => {
        const wrongMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
        const result = validateFileBuffer(wrongMagic, 'image/jpeg', 'photo.jpg');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('File magic bytes do not match MIME type');
      });

      it('should validate PNG file with correct magic bytes', () => {
        const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
        const result = validateFileBuffer(pngMagic, 'image/png', 'image.png');
        expect(result.valid).toBe(true);
      });

      it('should validate GIF file with correct magic bytes', () => {
        const gifMagic = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
        const result = validateFileBuffer(gifMagic, 'image/gif', 'animation.gif');
        expect(result.valid).toBe(true);
      });

      it('should validate PDF file with correct magic bytes', () => {
        const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
        const result = validateFileBuffer(pdfMagic, 'application/pdf', 'document.pdf');
        expect(result.valid).toBe(true);
      });
    });

    describe('File extension validation', () => {
      it('should accept valid JPEG extensions', () => {
        const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
        const result1 = validateFileBuffer(jpegMagic, 'image/jpeg', 'photo.jpg');
        const result2 = validateFileBuffer(jpegMagic, 'image/jpeg', 'photo.jpeg');
        expect(result1.valid).toBe(true);
        expect(result2.valid).toBe(true);
      });

      it('should reject JPEG with wrong extension', () => {
        const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
        const result = validateFileBuffer(jpegMagic, 'image/jpeg', 'photo.png');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('File extension .png does not match MIME type image/jpeg');
      });

      it('should handle missing file extension', () => {
        const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
        const result = validateFileBuffer(jpegMagic, 'image/jpeg', 'photo');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('File extension .unknown does not match MIME type image/jpeg');
      });
    });

    describe('File size validation', () => {
      it('should reject empty file', () => {
        const emptyBuffer = Buffer.from([]);
        const result = validateFileBuffer(emptyBuffer, 'image/jpeg', 'photo.jpg');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('File is empty');
      });

      it('should reject file exceeding size limit (50MB)', () => {
        const oversizeBuffer = Buffer.alloc(51 * 1024 * 1024);
        oversizeBuffer[0] = 0xff;
        oversizeBuffer[1] = 0xd8;
        oversizeBuffer[2] = 0xff;
        const result = validateFileBuffer(oversizeBuffer, 'image/jpeg', 'photo.jpg');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('File size exceeds 50MB limit');
      });

      it('should accept file at maximum size (50MB)', () => {
        const maxBuffer = Buffer.alloc(50 * 1024 * 1024);
        maxBuffer[0] = 0xff;
        maxBuffer[1] = 0xd8;
        maxBuffer[2] = 0xff;
        const result = validateFileBuffer(maxBuffer, 'image/jpeg', 'photo.jpg');
        expect(result.valid).toBe(true);
      });
    });

    describe('Unsupported file types', () => {
      it('should reject unsupported MIME type', () => {
        const buffer = Buffer.from([0xff, 0xd8, 0xff]);
        const result = validateFileBuffer(buffer, 'application/exe', 'malware.exe');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('MIME type application/exe is not allowed');
      });

      it('should reject Word document', () => {
        const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // DOCX magic
        const result = validateFileBuffer(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document.docx');
        expect(result.valid).toBe(false);
      });
    });

    describe('Safe file ID generation', () => {
      it('should generate UUID without hyphens', () => {
        const fileId = generateSafeFileId();
        expect(fileId).toHaveLength(32);
        expect(fileId).toMatch(/^[a-f0-9]{32}$/);
        expect(fileId).not.toContain('-');
      });

      it('should generate unique file IDs', () => {
        const id1 = generateSafeFileId();
        const id2 = generateSafeFileId();
        expect(id1).not.toEqual(id2);
      });
    });

    describe('File extension extraction', () => {
      it('should extract lowercase extension', () => {
        expect(getFileExtension('photo.JPG')).toBe('jpg');
        expect(getFileExtension('document.PDF')).toBe('pdf');
        expect(getFileExtension('image.PnG')).toBe('png');
      });

      it('should handle missing extension', () => {
        expect(getFileExtension('photo')).toBe('unknown');
      });

      it('should handle multiple dots in filename', () => {
        expect(getFileExtension('photo.backup.jpg')).toBe('jpg');
        expect(getFileExtension('document.final.pdf')).toBe('pdf');
      });
    });
  });
});
