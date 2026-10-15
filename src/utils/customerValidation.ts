export const CUSTOMER_LIMITS = {
  name: 100,
  email: 100,
  phone: 20,
  company: 100
} as const;

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[0-9+\-()\s]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export interface CustomerContactInput {
  customer_name?: unknown;
  customer_email?: unknown;
  customer_phone?: unknown;
  company_name?: unknown;
}

export interface CustomerContact {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  company_name?: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export type CustomerValidationResult =
  | { valid: true; value: CustomerContact }
  | { valid: false; errors: FieldError[] };

function normalize(raw: unknown, field: string, errors: FieldError[]): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (CONTROL_CHARS.test(trimmed)) {
    errors.push({ field, message: 'contains invalid control characters' });
    return undefined;
  }

  return trimmed;
}

function checkLength(value: string, max: number, field: string, errors: FieldError[]): boolean {
  if (value.length > max) {
    errors.push({ field, message: `must be at most ${max} characters` });
    return false;
  }
  return true;
}

function isValidPhone(phone: string): boolean {
  if (!PHONE_CHARS.test(phone)) {
    return false;
  }

  if (phone.lastIndexOf('+') > 0) {
    return false;
  }

  const digits = phone.replace(/\D/g, '').length;
  return digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS;
}

export function validateCustomerContact(input: CustomerContactInput): CustomerValidationResult {
  const errors: FieldError[] = [];

  const name = normalize(input.customer_name, 'customer_name', errors);
  const email = normalize(input.customer_email, 'customer_email', errors);
  const phone = normalize(input.customer_phone, 'customer_phone', errors);
  const company = normalize(input.company_name, 'company_name', errors);

  if (name !== undefined) {
    checkLength(name, CUSTOMER_LIMITS.name, 'customer_name', errors);
  }

  if (company !== undefined) {
    checkLength(company, CUSTOMER_LIMITS.company, 'company_name', errors);
  }

  if (email !== undefined) {
    if (checkLength(email, CUSTOMER_LIMITS.email, 'customer_email', errors) && !EMAIL_PATTERN.test(email)) {
      errors.push({ field: 'customer_email', message: 'must be a valid email address' });
    }
  }

  if (phone !== undefined) {
    if (checkLength(phone, CUSTOMER_LIMITS.phone, 'customer_phone', errors) && !isValidPhone(phone)) {
      errors.push({
        field: 'customer_phone',
        message: `must contain ${MIN_PHONE_DIGITS}-${MAX_PHONE_DIGITS} digits and only digits, spaces, +, -, ( )`
      });
    }
  }

  const emailRejected = errors.some(e => e.field === 'customer_email');
  const phoneRejected = errors.some(e => e.field === 'customer_phone');

  if (email === undefined && phone === undefined && !emailRejected && !phoneRejected) {
    errors.push({
      field: 'contact',
      message: 'at least one of customer_email or customer_phone is required'
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      company_name: company
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Customer type and privacy consent (PRD FR-4.2). Used by POST /api/estimates before anything is
// written: the receipt number is taken and the estimate stored only for a request that passes.

export const CUSTOMER_TYPES = ['individual_startup', 'business_brand'] as const;
export type SubmittedCustomerType = (typeof CUSTOMER_TYPES)[number];

export interface CustomerSubmissionInput extends CustomerContactInput {
  customer_type?: unknown;
  privacy_consent?: unknown;
  privacy_consent_version?: unknown;
}

export interface CustomerSubmission extends CustomerContact {
  customer_type: SubmittedCustomerType;
  privacy_consent_version: string;
}

export type CustomerSubmissionResult =
  | { valid: true; value: CustomerSubmission }
  | { valid: false; errors: FieldError[] };

export interface CustomerSubmissionOptions {
  // The consent versions the server accepts in this environment (config/privacyConsent.ts).
  acceptedConsentVersions: readonly string[];
}

function isMissing(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

// The contact rules of validateCustomerContact (an e-mail or a phone number is still enough as
// contact), plus: a customer type, a name for both types, a company or brand name for
// business_brand, and the privacy consent with an accepted version. The consent time is not an
// input: the server stamps it with the database time when it stores the request.
export function validateCustomerSubmission(
  input: CustomerSubmissionInput,
  options: CustomerSubmissionOptions
): CustomerSubmissionResult {
  const contact = validateCustomerContact(input);
  const errors: FieldError[] = contact.valid ? [] : [...contact.errors];
  const hasError = (field: string): boolean => errors.some(error => error.field === field);

  // Customer type.
  let customerType: SubmittedCustomerType | undefined;
  if (isMissing(input.customer_type)) {
    errors.push({ field: 'customer_type', message: 'is required' });
  } else if (typeof input.customer_type !== 'string') {
    errors.push({ field: 'customer_type', message: 'must be a string' });
  } else if (!(CUSTOMER_TYPES as readonly string[]).includes(input.customer_type.trim())) {
    errors.push({ field: 'customer_type', message: `must be one of: ${CUSTOMER_TYPES.join(', ')}` });
  } else {
    customerType = input.customer_type.trim() as SubmittedCustomerType;
  }

  // The name is required for both types. (Invalid names are already reported by the contact check.)
  // (Read from the input itself: the contact check returns no values when it failed on something else.)
  const scratch: FieldError[] = [];
  const name = normalize(input.customer_name, 'customer_name', scratch);
  if (name === undefined && !hasError('customer_name')) {
    errors.push({ field: 'customer_name', message: 'is required' });
  }

  // A business or brand needs a company or brand name (stored in company_name).
  const company = normalize(input.company_name, 'company_name', scratch);
  if (customerType === 'business_brand' && company === undefined && !hasError('company_name')) {
    errors.push({ field: 'company_name', message: 'is required for customer_type business_brand' });
  }

  // Consent: exactly the boolean true. (Form data has no booleans: the route turns the text
  // "true" of a multipart request into true before it gets here.)
  if (input.privacy_consent === undefined || input.privacy_consent === null) {
    errors.push({ field: 'privacy_consent', message: 'is required' });
  } else if (input.privacy_consent !== true) {
    errors.push({ field: 'privacy_consent', message: 'must be true' });
  }

  // Version of the consent text the customer saw: must be one the server knows.
  let consentVersion: string | undefined;
  if (isMissing(input.privacy_consent_version)) {
    errors.push({ field: 'privacy_consent_version', message: 'is required' });
  } else if (typeof input.privacy_consent_version !== 'string') {
    errors.push({ field: 'privacy_consent_version', message: 'must be a string' });
  } else if (!options.acceptedConsentVersions.includes(input.privacy_consent_version.trim())) {
    errors.push({ field: 'privacy_consent_version', message: 'is not an accepted consent version' });
  } else {
    consentVersion = input.privacy_consent_version.trim();
  }

  if (errors.length > 0 || !contact.valid || customerType === undefined || consentVersion === undefined) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      ...contact.value,
      customer_type: customerType,
      privacy_consent_version: consentVersion
    }
  };
}
