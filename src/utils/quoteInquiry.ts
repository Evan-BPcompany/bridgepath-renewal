// What a customer may send about a published quote, and what the staff answer. No database here.
//
// Two kinds: a short question (at most 300 characters, so it stays a question and not a project) that
// the staff answer in writing, and a request for an in-depth consultation, for which the staff phone
// the customer.

export const INQUIRY_LIMITS = {
  // Characters, not bytes: 300 Korean letters are 300.
  questionLength: 300,
  noteLength: 300,
  answerLength: 500,
  phoneLength: 20,
  // Per request: enough for a conversation, not for a flood.
  perEstimate: 20
} as const;

export const PREFERRED_TIMES = ['any', 'weekday_am', 'weekday_pm'] as const;
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

export interface InquiryFieldError {
  field: string;
  message: string;
}

export type InquiryInput =
  | { kind: 'question'; body: string }
  | { kind: 'consultation'; phone: string; preferred_time: PreferredTime; body: string | null };

export type InquiryResult =
  | { valid: true; value: InquiryInput }
  | { valid: false; errors: InquiryFieldError[] };

// Line breaks are fine in a question; other control characters are not.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PHONE_CHARS = /^[0-9+\-()\s]+$/;

export const countCharacters = (text: string): number => Array.from(text).length;

function text(
  raw: unknown,
  field: string,
  max: number,
  required: boolean,
  errors: InquiryFieldError[]
): string | null {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) {
      errors.push({ field, message: 'is required' });
    }
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return null;
  }
  const value = raw.trim();
  if (CONTROL_CHARS.test(value)) {
    errors.push({ field, message: 'contains invalid control characters' });
    return null;
  }
  if (countCharacters(value) > max) {
    errors.push({ field, message: `must be at most ${max} characters` });
    return null;
  }
  return value;
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '').length;
  return PHONE_CHARS.test(phone) && digits >= 7 && digits <= 15;
}

export function parseInquiryInput(body: unknown): InquiryResult {
  const errors: InquiryFieldError[] = [];
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  if (input.kind !== 'question' && input.kind !== 'consultation') {
    return { valid: false, errors: [{ field: 'kind', message: 'must be question or consultation' }] };
  }

  if (input.kind === 'question') {
    const question = text(input.body, 'body', INQUIRY_LIMITS.questionLength, true, errors);
    if (errors.length > 0 || question === null) {
      return { valid: false, errors };
    }
    return { valid: true, value: { kind: 'question', body: question } };
  }

  // ---- consultation: the phone to call is needed, the time and a note are optional
  const phone = text(input.phone, 'phone', INQUIRY_LIMITS.phoneLength, true, errors);
  if (phone !== null && !isValidPhone(phone)) {
    errors.push({ field: 'phone', message: 'must contain 7-15 digits and only digits, spaces, +, -, ( )' });
  }
  let preferred: PreferredTime = 'any';
  if (input.preferred_time !== undefined && input.preferred_time !== null && input.preferred_time !== '') {
    if (!(PREFERRED_TIMES as readonly unknown[]).includes(input.preferred_time)) {
      errors.push({ field: 'preferred_time', message: 'must be any, weekday_am or weekday_pm' });
    } else {
      preferred = input.preferred_time as PreferredTime;
    }
  }
  const note = text(input.body, 'body', INQUIRY_LIMITS.noteLength, false, errors);

  if (errors.length > 0 || phone === null) {
    return { valid: false, errors };
  }
  return { valid: true, value: { kind: 'consultation', phone, preferred_time: preferred, body: note } };
}

export type AnswerResult = { valid: true; value: string } | { valid: false; errors: InquiryFieldError[] };

// The staff's written answer to a question.
export function parseAnswer(body: unknown): AnswerResult {
  const errors: InquiryFieldError[] = [];
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const answer = text(input.answer, 'answer', INQUIRY_LIMITS.answerLength, true, errors);
  return errors.length > 0 || answer === null ? { valid: false, errors } : { valid: true, value: answer };
}

// An optional note after the call.
export function parseDoneNote(body: unknown): { valid: true; value: string | null } | { valid: false; errors: InquiryFieldError[] } {
  const errors: InquiryFieldError[] = [];
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const note = text(input.note, 'note', INQUIRY_LIMITS.noteLength, false, errors);
  return errors.length > 0 ? { valid: false, errors } : { valid: true, value: note };
}
