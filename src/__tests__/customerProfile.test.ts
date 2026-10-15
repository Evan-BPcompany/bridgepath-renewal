import { CUSTOMER_TYPES, validateCustomerSubmission } from '../utils/customerValidation';

// customer_type, name, company name, privacy consent and consent version, together with the
// existing "e-mail or phone" contact rule.
const ACCEPTED = ['dev-draft'];
const valid = {
  customer_type: 'individual_startup',
  customer_name: 'Kim',
  customer_email: 'buyer@example.com',
  privacy_consent: true,
  privacy_consent_version: 'dev-draft'
};

const run = (overrides: Record<string, unknown> = {}, accepted: readonly string[] = ACCEPTED) =>
  validateCustomerSubmission({ ...valid, ...overrides }, { acceptedConsentVersions: accepted });
const fieldsOf = (result: ReturnType<typeof run>): string[] =>
  result.valid ? [] : result.errors.map(error => error.field).sort();
const messageOf = (result: ReturnType<typeof run>, field: string): string | undefined =>
  result.valid ? undefined : result.errors.find(error => error.field === field)?.message;

describe('customer type and privacy consent validation', () => {
  it('knows exactly the two PRD customer types', () => {
    expect([...CUSTOMER_TYPES]).toEqual(['individual_startup', 'business_brand']);
  });

  it('accepts a complete individual request and returns the cleaned values', () => {
    const result = run({ customer_name: '  Kim  ', privacy_consent_version: ' dev-draft ' });

    expect(result).toEqual({
      valid: true,
      value: {
        customer_name: 'Kim',
        customer_email: 'buyer@example.com',
        customer_phone: undefined,
        company_name: undefined,
        customer_type: 'individual_startup',
        privacy_consent_version: 'dev-draft'
      }
    });
  });

  describe('customer_type', () => {
    it.each(['individual_startup', 'business_brand'])('accepts %s', type => {
      expect(run({ customer_type: type, company_name: 'Acme' }).valid).toBe(true);
    });

    it.each([undefined, null, '', '   '])('requires it (%j)', value => {
      const result = run({ customer_type: value });
      expect(fieldsOf(result)).toEqual(['customer_type']);
      expect(messageOf(result, 'customer_type')).toBe('is required');
    });

    it.each(['individual', 'business', 'Individual_Startup', 'BUSINESS_BRAND', '개인·창업 준비 중', 'other'])(
      'refuses the unknown value %j and names the allowed ones',
      value => {
        const result = run({ customer_type: value });
        expect(fieldsOf(result)).toEqual(['customer_type']);
        expect(messageOf(result, 'customer_type')).toContain('individual_startup, business_brand');
      }
    );

    it.each([1, true, {}, ['individual_startup']])('refuses a value that is not a string (%j)', value => {
      expect(messageOf(run({ customer_type: value }), 'customer_type')).toBe('must be a string');
    });
  });

  describe('customer_name (required for both types)', () => {
    it.each(['individual_startup', 'business_brand'])('is required for %s', type => {
      for (const missing of [undefined, null, '', '   ']) {
        const result = run({ customer_type: type, company_name: 'Acme', customer_name: missing });
        expect(fieldsOf(result)).toEqual(['customer_name']);
        expect(messageOf(result, 'customer_name')).toBe('is required');
      }
    });

    it('keeps the existing length and character rules (one error, not two)', () => {
      const result = run({ customer_name: 'x'.repeat(101) });
      expect(result.valid ? [] : result.errors.filter(error => error.field === 'customer_name')).toHaveLength(1);
      expect(messageOf(result, 'customer_name')).toContain('at most 100');
    });
  });

  describe('company_name (required for business_brand only)', () => {
    it('is optional for individual_startup', () => {
      expect(run({ customer_type: 'individual_startup' }).valid).toBe(true);
      expect(run({ customer_type: 'individual_startup', company_name: 'My brand' }).valid).toBe(true);
    });

    it.each([undefined, null, '', '   '])('is required for business_brand (%j)', value => {
      const result = run({ customer_type: 'business_brand', company_name: value });
      expect(fieldsOf(result)).toEqual(['company_name']);
      expect(messageOf(result, 'company_name')).toBe('is required for customer_type business_brand');
    });

    it('is accepted for business_brand with a company or brand name', () => {
      expect(run({ customer_type: 'business_brand', company_name: ' Acme ' }).valid).toBe(true);
    });

    it('is not reported twice when the customer type itself is wrong', () => {
      expect(fieldsOf(run({ customer_type: 'nope', company_name: undefined }))).toEqual(['customer_type']);
    });
  });

  describe('contact (unchanged: an e-mail or a phone number)', () => {
    it('still accepts a phone number only', () => {
      expect(run({ customer_email: undefined, customer_phone: '010-1234-5678' }).valid).toBe(true);
    });

    it('still requires one of them, reported as the single field "contact"', () => {
      const result = run({ customer_email: undefined });
      expect(fieldsOf(result)).toEqual(['contact']);
    });

    it('reports a missing contact together with other problems', () => {
      expect(fieldsOf(run({ customer_email: undefined, customer_type: undefined, privacy_consent: undefined }))).toEqual([
        'contact',
        'customer_type',
        'privacy_consent'
      ]);
    });

    it('a name is still required when the contact is invalid (no false "customer_name" error when it is given)', () => {
      expect(fieldsOf(run({ customer_email: 'nope' }))).toEqual(['customer_email']);
    });
  });

  describe('privacy_consent (the boolean true, nothing else)', () => {
    it('accepts true', () => {
      expect(run({ privacy_consent: true }).valid).toBe(true);
    });

    it.each([undefined, null])('is required (%j)', value => {
      const result = run({ privacy_consent: value });
      expect(fieldsOf(result)).toEqual(['privacy_consent']);
      expect(messageOf(result, 'privacy_consent')).toBe('is required');
    });

    it.each([false, 'true', 'false', 'yes', 'on', 1, 0, '1', {}, [true], 'True'])('refuses %j', value => {
      const result = run({ privacy_consent: value });
      expect(fieldsOf(result)).toEqual(['privacy_consent']);
      expect(messageOf(result, 'privacy_consent')).toBe('must be true');
    });
  });

  describe('privacy_consent_version (must be one the server accepts)', () => {
    it('accepts a listed version', () => {
      expect(run({ privacy_consent_version: 'dev-draft' }).valid).toBe(true);
      expect(run({ privacy_consent_version: '2026-v1' }, ['2026-v1', 'dev-draft']).valid).toBe(true);
    });

    it.each([undefined, null, '', '   '])('is required (%j)', value => {
      const result = run({ privacy_consent_version: value });
      expect(fieldsOf(result)).toEqual(['privacy_consent_version']);
      expect(messageOf(result, 'privacy_consent_version')).toBe('is required');
    });

    it.each(['v1', 'DEV-DRAFT', 'dev-draft ;', 'dev_draft', 'dev-draft/../x', "' OR 1=1 --"])(
      'refuses the unlisted version %j without echoing it',
      value => {
        const result = run({ privacy_consent_version: value });
        expect(fieldsOf(result)).toEqual(['privacy_consent_version']);
        expect(messageOf(result, 'privacy_consent_version')).toBe('is not an accepted consent version');
        expect(JSON.stringify(result)).not.toContain(value);
      }
    );

    it.each([1, true, {}, ['dev-draft']])('refuses a value that is not a string (%j)', value => {
      expect(messageOf(run({ privacy_consent_version: value }), 'privacy_consent_version')).toBe('must be a string');
    });

    it('depends on the list it is given: dev-draft is refused when the list does not have it', () => {
      expect(fieldsOf(run({}, []))).toEqual(['privacy_consent_version']);
      expect(fieldsOf(run({}, ['2026-v1']))).toEqual(['privacy_consent_version']);
      expect(run({ privacy_consent_version: '2026-v1' }, ['2026-v1']).valid).toBe(true);
    });
  });

  it('the consent time is not an input: a time sent by the client is ignored and never returned', () => {
    const result = run({ privacy_consent_at: '1999-01-01T00:00:00Z', consent_at: 'now' });

    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/1999|consent_at/);
  });

  it('reports every problem of a request at once, in a stable shape', () => {
    const result = validateCustomerSubmission({}, { acceptedConsentVersions: ACCEPTED });

    expect(result.valid).toBe(false);
    expect(fieldsOf(result)).toEqual([
      'contact',
      'customer_name',
      'customer_type',
      'privacy_consent',
      'privacy_consent_version'
    ]);
    if (!result.valid) {
      for (const error of result.errors) {
        expect(Object.keys(error).sort()).toEqual(['field', 'message']);
      }
    }
  });
});
