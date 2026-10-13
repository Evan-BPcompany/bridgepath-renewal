// Decides what may reach the log. Metadata is allowlist-based: a key that is not listed is
// dropped, and a key whose name looks sensitive is dropped even if someone adds it to the
// allowlist by mistake. Values are masked and cut to a fixed length.

export const ALLOWED_LOG_KEYS: ReadonlySet<string> = new Set([
  'error',
  'error_code',
  'errorCode',
  'error_count',
  'errorCount',
  'lastError',
  'event_id',
  'estimate_id',
  'estimateId',
  'file_id',
  'fileId',
  'memo_id',
  'admin_id',
  'receipt_id',
  'receiptId',
  'message_id',
  'category',
  'status',
  'http_status',
  'count',
  'uploadedCount',
  'retry_count',
  'maxRetries',
  'attempt',
  'attempts',
  'delay_minutes',
  'interval_ms',
  'stale_timeout_ms',
  'sequence',
  'date',
  'bucket'
]);

// Names that never reach the log, whatever the allowlist says.
export const SENSITIVE_KEY_PATTERN =
  /pass(word|wd)?|token|hash|secret|api[_-]?key|e-?mail|phone|authorization|cookie|body|content|reason|s3[_-]?key|credential|session/i;

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_VALUE_LENGTH = 300;
export const MAX_STACK_LENGTH = 2000;

const MASK = '***';

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
}

// Removes secrets that can hide inside free text such as error messages.
export function maskSensitiveText(text: string): string {
  return (
    text
      // user:password@ inside a URL
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*):([^\s/@]*)@/gi, `$1$2:${MASK}@`)
      // Bearer / Basic credentials
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MASK}`)
      // JSON web tokens
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, MASK)
      // SendGrid keys
      .replace(/\bSG\.[A-Za-z0-9_-]{10,}/g, MASK)
      // AWS access key ids
      .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, MASK)
      // key=value / key: value pairs with a sensitive name
      .replace(
        /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\b(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
        `$1$2${MASK}`
      )
      // e-mail addresses
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, `${MASK}@${MASK}`)
      // long hex strings (hashes, random tokens)
      .replace(/\b[a-f0-9]{32,}\b/gi, MASK)
  );
}

export function sanitizeText(text: string, max: number): string {
  return truncate(maskSensitiveText(text), max);
}

export type LogValue = string | number | boolean | null;

export function sanitizeValue(value: unknown): LogValue | undefined {
  if (typeof value === 'string') {
    return sanitizeText(value, MAX_VALUE_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  // Objects, arrays, functions and the like are never written: they can hold anything.
  return undefined;
}

export function sanitizeMeta(meta: Record<string, unknown>): Record<string, LogValue> {
  const result: Record<string, LogValue> = {};

  for (const key of Object.keys(meta)) {
    if (!ALLOWED_LOG_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    const value = sanitizeValue(meta[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
