import logger from './logger';

// The console log format prints only the message, so the audit entry is serialized
// into the message itself. Only whitelisted keys are written; memo bodies, email
// bodies, passwords and tokens can never reach the log through this helper.
const ALLOWED_KEYS = [
  'action',
  'result',
  'http_status',
  'admin_id',
  'role',
  'estimate_id',
  'file_id',
  'from_status',
  'to_status',
  'error_code',
  'ip'
] as const;

export type AuditKey = (typeof ALLOWED_KEYS)[number];
export type AuditEntry = Partial<Record<AuditKey, string | number | boolean | null | undefined>> & {
  action: string;
  result: string;
};

const MAX_VALUE_LENGTH = 100;

export function buildAuditRecord(entry: AuditEntry): Record<string, string | number | boolean | null> {
  const record: Record<string, string | number | boolean | null> = {};

  for (const key of ALLOWED_KEYS) {
    const value = (entry as Record<string, unknown>)[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      record[key] = value.slice(0, MAX_VALUE_LENGTH);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      record[key] = value;
    }
  }

  return record;
}

export function logAdminAudit(entry: AuditEntry): void {
  const record = buildAuditRecord(entry);
  const message = `admin_audit ${JSON.stringify(record)}`;

  if (entry.result === 'success') {
    logger.info(message);
  } else {
    logger.warn(message);
  }
}
