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
