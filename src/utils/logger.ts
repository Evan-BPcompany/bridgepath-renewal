import winston from 'winston';
import { config } from '../config/env';
import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  sanitizeMeta,
  sanitizeText
} from './logSanitizer';

// Everything that is written goes through this format first: the message and the stack are
// masked and cut, and the metadata is reduced to the allowlist in logSanitizer.ts.
const RESERVED = new Set(['level', 'message', 'timestamp', 'stack', 'service']);

const sanitize = winston.format(info => {
  const meta: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (!RESERVED.has(key)) {
      meta[key] = (info as Record<string, unknown>)[key];
      delete (info as Record<string, unknown>)[key];
    }
  }

  info.message = sanitizeText(String(info.message), MAX_MESSAGE_LENGTH);
  if (typeof info.stack === 'string') {
    info.stack = sanitizeText(info.stack, MAX_STACK_LENGTH);
  }
  Object.assign(info, sanitizeMeta(meta));

  return info;
});

export function formatLogLine(info: winston.Logform.TransformableInfo): string {
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (!RESERVED.has(key)) {
      extra[key] = info[key];
    }
  }

  const meta = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  const line = `${info.timestamp} ${info.level}: ${info.message}${meta}`;
  return info.stack ? `${line}\n${info.stack}` : line;
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  sanitize(),
  winston.format.printf(formatLogLine)
);

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: logFormat,
  transports: [new winston.transports.Console()],
  defaultMeta: { service: 'bridge-path-mvp' }
});

export default logger;
