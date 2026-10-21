// What a detailed quote may contain and how its money is counted. No database here.
//
// The amounts are Korean won as whole numbers. The server counts every amount and the total itself
// (quantity x unit price); a number sent by a client as "amount" or "total" is never used.

export const QUOTE_LIMITS = {
  items: 30,
  nameLength: 200,
  quantityMax: 1_000_000,
  unitPriceMax: 100_000_000,
  leadTimeLength: 200,
  noteLength: 2000,
  fxRateMax: 1_000_000
} as const;

export interface QuoteItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface PricedQuoteItem extends QuoteItem {
  amount: number;
}

export interface QuoteInput {
  items: QuoteItem[];
  fx_currency: string | null;
  fx_rate: number | null;
  valid_until: string | null;
  lead_time: string | null;
  customer_note: string | null;
  // The edit_seq of the working copy this save was made from; null for the first save.
  expected_edit_seq: number | null;
}

export interface QuoteFieldError {
  field: string;
  message: string;
}

export type QuoteInputResult =
  | { valid: true; value: QuoteInput }
  | { valid: false; errors: QuoteFieldError[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_NO_NEWLINE = /[\u0000-\u001F\u007F]/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function priceItems(items: QuoteItem[]): { items: PricedQuoteItem[]; total: number } {
  const priced = items.map(item => ({ ...item, amount: item.quantity * item.unit_price }));
  return { items: priced, total: priced.reduce((sum, item) => sum + item.amount, 0) };
}

// Today in Korea as YYYY-MM-DD: the validity of a quote is a date of the customer's calendar.
export function todayInKorea(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}

export function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function optionalText(
  raw: unknown,
  field: string,
  max: number,
  allowNewlines: boolean,
  errors: QuoteFieldError[]
): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return null;
  }
  const value = raw.trim();
  if (value === '') {
    return null;
  }
  if ((allowNewlines ? CONTROL_CHARS : CONTROL_CHARS_NO_NEWLINE).test(value)) {
    errors.push({ field, message: 'contains invalid control characters' });
    return null;
  }
  if (value.length > max) {
    errors.push({ field, message: `must be at most ${max} characters` });
    return null;
  }
  return value;
}

export function parseQuoteInput(body: unknown, today: string = todayInKorea()): QuoteInputResult {
  const errors: QuoteFieldError[] = [];
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  // ---- items
  const items: QuoteItem[] = [];
  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push({ field: 'items', message: 'at least one item is required' });
  } else if (input.items.length > QUOTE_LIMITS.items) {
    errors.push({ field: 'items', message: `at most ${QUOTE_LIMITS.items} items` });
  } else {
    input.items.forEach((raw: unknown, index: number) => {
      const field = `items[${index}]`;
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      if (!item) {
        errors.push({ field, message: 'must be an object' });
        return;
      }
      const name = optionalText(item.name, `${field}.name`, QUOTE_LIMITS.nameLength, false, errors);
      if (name === null && !errors.some(e => e.field === `${field}.name`)) {
        errors.push({ field: `${field}.name`, message: 'is required' });
      }
      const quantity = item.quantity;
      if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > QUOTE_LIMITS.quantityMax) {
        errors.push({ field: `${field}.quantity`, message: `must be a whole number from 1 to ${QUOTE_LIMITS.quantityMax}` });
      }
      const unitPrice = item.unit_price;
      if (!Number.isInteger(unitPrice) || (unitPrice as number) < 0 || (unitPrice as number) > QUOTE_LIMITS.unitPriceMax) {
        errors.push({ field: `${field}.unit_price`, message: `must be a whole number of won from 0 to ${QUOTE_LIMITS.unitPriceMax}` });
      }
      if (name !== null && Number.isInteger(quantity) && Number.isInteger(unitPrice)) {
        items.push({ name, quantity: quantity as number, unit_price: unitPrice as number });
      }
    });
  }

  // ---- exchange rate: the currency and the rate go together
  let fxCurrency: string | null = null;
  let fxRate: number | null = null;
  const hasCurrency = input.fx_currency !== undefined && input.fx_currency !== null && input.fx_currency !== '';
  const hasRate = input.fx_rate !== undefined && input.fx_rate !== null && input.fx_rate !== '';
  if (hasCurrency || hasRate) {
    if (typeof input.fx_currency !== 'string' || !CURRENCY.test(input.fx_currency)) {
      errors.push({ field: 'fx_currency', message: 'must be a 3-letter currency code such as USD' });
    } else {
      fxCurrency = input.fx_currency;
    }
    const rate = input.fx_rate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > QUOTE_LIMITS.fxRateMax) {
      errors.push({ field: 'fx_rate', message: `must be a number above 0 and at most ${QUOTE_LIMITS.fxRateMax}` });
    } else if (Math.round(rate * 10000) / 10000 !== rate) {
      errors.push({ field: 'fx_rate', message: 'must have at most 4 decimals' });
    } else {
      fxRate = rate;
    }
  }

  // ---- validity: a real date that is not already past
  let validUntil: string | null = null;
  if (input.valid_until !== undefined && input.valid_until !== null && input.valid_until !== '') {
    if (typeof input.valid_until !== 'string' || !isRealDate(input.valid_until)) {
      errors.push({ field: 'valid_until', message: 'must be a date as YYYY-MM-DD' });
    } else if (input.valid_until < today) {
      errors.push({ field: 'valid_until', message: 'must not be in the past' });
    } else {
      validUntil = input.valid_until;
    }
  }

  const leadTime = optionalText(input.lead_time, 'lead_time', QUOTE_LIMITS.leadTimeLength, false, errors);
  const note = optionalText(input.customer_note, 'customer_note', QUOTE_LIMITS.noteLength, true, errors);

  // ---- which copy this save was made from
  let expected: number | null = null;
  if (input.expected_edit_seq !== undefined && input.expected_edit_seq !== null) {
    if (!Number.isInteger(input.expected_edit_seq) || (input.expected_edit_seq as number) < 1) {
      errors.push({ field: 'expected_edit_seq', message: 'must be a whole number from 1' });
    } else {
      expected = input.expected_edit_seq as number;
    }
  }

  // ---- the total has to fit what the database and a JavaScript number keep exactly
  if (errors.length === 0) {
    const { total } = priceItems(items);
    if (!Number.isSafeInteger(total) || total > 1_000_000_000_000_000) {
      errors.push({ field: 'items', message: 'the total is too large' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    value: { items, fx_currency: fxCurrency, fx_rate: fxRate, valid_until: validUntil, lead_time: leadTime, customer_note: note, expected_edit_seq: expected }
  };
}
