import fs from 'fs';
import path from 'path';
import { validateCustomerContact, CUSTOMER_LIMITS } from '../utils/customerValidation';

describe('Customer contact validation (PRD FR-4.2: email OR phone)', () => {
  it('accepts email only', () => {
    const result = validateCustomerContact({ customer_email: 'buyer@example.com' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.customer_email).toBe('buyer@example.com');
      expect(result.value.customer_phone).toBeUndefined();
    }
  });

  it('accepts phone only', () => {
    const result = validateCustomerContact({ customer_phone: '010-1234-5678' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.customer_email).toBeUndefined();
      expect(result.value.customer_phone).toBe('010-1234-5678');
    }
  });

  it('accepts both email and phone', () => {
    const result = validateCustomerContact({
      customer_email: 'a@b.co',
      customer_phone: '+82 10 1234 5678'
    });
    expect(result.valid).toBe(true);
  });

  it('rejects when both email and phone are missing', () => {
    const result = validateCustomerContact({ customer_name: 'Kim' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        { field: 'contact', message: expect.stringContaining('customer_email or customer_phone') }
      ]);
    }
  });

  it('treats blank email and phone as missing', () => {
    const result = validateCustomerContact({ customer_email: '   ', customer_phone: '' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe('contact');
    }
  });

  it('trims whitespace before saving', () => {
    const result = validateCustomerContact({
      customer_email: '  buyer@example.com  ',
      customer_name: '  Kim  '
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.customer_email).toBe('buyer@example.com');
      expect(result.value.customer_name).toBe('Kim');
    }
  });

  it('reports an invalid email only on the email field (not as missing contact)', () => {
    const result = validateCustomerContact({ customer_email: 'not-an-email' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map(e => e.field)).toEqual(['customer_email']);
    }
  });

  it('rejects an invalid email even when a valid phone is present', () => {
    const result = validateCustomerContact({
      customer_email: 'bad@',
      customer_phone: '01012345678'
    });
    expect(result.valid).toBe(false);
  });

  it('rejects an email longer than the DB column (100)', () => {
    const longEmail = `${'a'.repeat(CUSTOMER_LIMITS.email)}@example.com`;
    const result = validateCustomerContact({ customer_email: longEmail });
    expect(result.valid).toBe(false);
  });

  it('rejects phone with letters, too few digits, too many digits, or misplaced +', () => {
    const invalid = ['010-abcd-5678', '12345', '1234567890123456', '010+1234567'];
    for (const phone of invalid) {
      const result = validateCustomerContact({ customer_phone: phone });
      expect(result.valid).toBe(false);
    }
  });

  it('rejects a phone longer than the DB column (20)', () => {
    const result = validateCustomerContact({ customer_phone: '1'.repeat(CUSTOMER_LIMITS.phone + 1) });
    expect(result.valid).toBe(false);
  });

  it('enforces name and company length limits (100)', () => {
    const tooLong = 'x'.repeat(CUSTOMER_LIMITS.name + 1);
    const result = validateCustomerContact({
      customer_email: 'a@b.co',
      customer_name: tooLong,
      company_name: tooLong
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map(e => e.field).sort()).toEqual(['company_name', 'customer_name']);
    }
  });

  it('accepts names at exactly the limit', () => {
    const result = validateCustomerContact({
      customer_email: 'a@b.co',
      customer_name: 'x'.repeat(CUSTOMER_LIMITS.name),
      company_name: 'y'.repeat(CUSTOMER_LIMITS.company)
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-string values and control characters', () => {
    expect(validateCustomerContact({ customer_email: 12345 }).valid).toBe(false);
    expect(validateCustomerContact({ customer_email: { a: 1 } }).valid).toBe(false);
    expect(validateCustomerContact({ customer_email: 'a@b.co', customer_name: 'Kim\u0000' }).valid).toBe(false);
    expect(validateCustomerContact({ customer_email: 'a@b.co', company_name: 'Co\nInc' }).valid).toBe(false);
  });
});

describe('Migration 008: customer contact policy', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '008_customer_contact_policy.ts'),
    'utf8'
  );
  const [upPart, downPart] = source.split('export async function down');

  it('up makes customer_email nullable and adds the email-or-phone CHECK', () => {
    expect(upPart).toContain('ALTER COLUMN customer_email DROP NOT NULL');
    expect(upPart).toContain('ADD CONSTRAINT estimates_contact_required');
    expect(upPart).toContain('customer_email');
    expect(upPart).toContain('customer_phone');
  });

  it('down drops the CHECK and restores NOT NULL', () => {
    expect(downPart).toContain('DROP CONSTRAINT IF EXISTS estimates_contact_required');
    expect(downPart).toContain('ALTER COLUMN customer_email SET NOT NULL');
  });

  it('applies and reverts the changes in a safe order', () => {
    expect(upPart.indexOf('DROP NOT NULL')).toBeLessThan(upPart.indexOf('ADD CONSTRAINT'));
    expect(upPart.indexOf('DROP CONSTRAINT IF EXISTS')).toBeLessThan(upPart.indexOf('ADD CONSTRAINT'));
    // The CHECK must be removed before NOT NULL is restored.
    expect(downPart.indexOf('DROP CONSTRAINT')).toBeLessThan(downPart.indexOf('SET NOT NULL'));
  });

  it('accepts a row when either email or phone is non-blank (CHECK expression)', () => {
    expect(upPart).toMatch(/btrim\(coalesce\(customer_email, ''\)\) <> ''\s+OR btrim\(coalesce\(customer_phone, ''\)\) <> ''/);
  });

  it('does not modify earlier migration files', () => {
    const initSource = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '001_init_schema.ts'),
      'utf8'
    );
    expect(initSource).toContain('customer_email VARCHAR(100) NOT NULL');
  });
});
