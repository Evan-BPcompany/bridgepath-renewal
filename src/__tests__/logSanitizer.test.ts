import { Writable } from 'stream';
import winston from 'winston';
import logger from '../utils/logger';
import {
  ALLOWED_LOG_KEYS,
  MAX_MESSAGE_LENGTH,
  MAX_VALUE_LENGTH,
  SENSITIVE_KEY_PATTERN,
  maskSensitiveText,
  sanitizeMeta,
  sanitizeValue
} from '../utils/logSanitizer';

describe('maskSensitiveText', () => {
  it('masks the password inside a URL but keeps host and database', () => {
    const out = maskSensitiveText('connect postgres://app_user:Sup3rSecret@db.example.com:5432/bridgepath failed');

    expect(out).not.toContain('Sup3rSecret');
    expect(out).toContain('postgres://app_user:***@db.example.com:5432/bridgepath');
  });

  it('masks a URL password that contains odd characters', () => {
    expect(maskSensitiveText('redis://:p%40ss!word@cache:6379')).not.toContain('p%40ss');
  });

  it('masks e-mail addresses', () => {
    const out = maskSensitiveText('delivery to buyer.name+tag@example.co.kr rejected');

    expect(out).not.toContain('buyer');
    expect(out).not.toContain('example.co.kr');
  });

  it('masks bearer tokens, JWTs, SendGrid keys and AWS key ids', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhIjoiYiJ9.c2lnbmF0dXJl';
    const sendgrid = `SG.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    const aws = `AKIA${'Q'.repeat(16)}`;
    const out = maskSensitiveText(`Authorization: Bearer abc.def-ghi ${jwt} ${sendgrid} ${aws}`);

    for (const secret of ['abc.def-ghi', jwt, sendgrid, aws]) {
      expect(out).not.toContain(secret);
    }
  });

  it('masks key=value pairs with a sensitive name', () => {
    const out = maskSensitiveText('password=hunter2&token: abc123 api_key="k-999" secret=s3');

    for (const secret of ['hunter2', 'abc123', 'k-999', 's3']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('password=***');
  });

  it('masks long hex strings (hashes, random tokens) but not receipt ids or UUIDs', () => {
    const hex = 'a1b2c3d4'.repeat(8);
    const out = maskSensitiveText(`hash ${hex} receipt BP20261013001 id a0000000-0000-0000-0000-000000000001`);

    expect(out).not.toContain(hex);
    expect(out).toContain('BP20261013001');
    expect(out).toContain('a0000000-0000-0000-0000-000000000001');
  });

  it('leaves ordinary text alone', () => {
    expect(maskSensitiveText('Failed to claim pending email events')).toBe('Failed to claim pending email events');
  });
});

describe('sanitizeValue', () => {
  it('keeps primitives, cuts long strings and drops objects', () => {
    expect(sanitizeValue(3)).toBe(3);
    expect(sanitizeValue(true)).toBe(true);
    expect(sanitizeValue(null)).toBeNull();
    expect(sanitizeValue({ a: 1 })).toBeUndefined();
    expect(sanitizeValue(['x'])).toBeUndefined();
    expect(sanitizeValue(undefined)).toBeUndefined();
    expect(sanitizeValue(() => 1)).toBeUndefined();

    const long = sanitizeValue('x'.repeat(MAX_VALUE_LENGTH * 3)) as string;
    expect(long.length).toBeLessThan(MAX_VALUE_LENGTH + 30);
    expect(long).toContain('[truncated]');
  });
});

describe('sanitizeMeta', () => {
  it('keeps allowlisted identifiers and results', () => {
    const meta = { event_id: 'e1', estimateId: 'est-1', retry_count: 2, count: 4, error: 'timeout' };

    expect(sanitizeMeta(meta)).toEqual(meta);
  });

  it.each([
    'password',
    'new_password',
    'access_token',
    'refresh_token',
    'password_hash',
    'jwtSecret',
    'api_key',
    'apiKey',
    'customer_email',
    'recipient_email',
    'email',
    'phone',
    'customer_phone',
    'authorization',
    'cookie',
    'body',
    'content',
    'reason',
    's3_key',
    's3Key',
    'key',
    'subject',
    'stack_trace',
    'specification_json',
    'errors',
    'details'
  ])('drops %s', name => {
    expect(sanitizeMeta({ [name]: 'value-that-must-not-appear', event_id: 'e1' })).toEqual({ event_id: 'e1' });
  });

  it('drops a sensitive key even when it was added to the allowlist by mistake', () => {
    for (const key of ALLOWED_LOG_KEYS) {
      expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(false);
    }

    const mutable = ALLOWED_LOG_KEYS as Set<string>;
    mutable.add('refresh_token');
    try {
      expect(sanitizeMeta({ refresh_token: 'abc' })).toEqual({});
    } finally {
      mutable.delete('refresh_token');
    }
  });

  it('masks secrets inside allowed values', () => {
    const out = sanitizeMeta({
      error: 'connect postgres://u:pw123@h/db failed for a@b.com',
      lastError: 'token=abc'
    });

    expect(JSON.stringify(out)).not.toMatch(/pw123|a@b\.com|abc/);
  });

  it('drops allowed keys whose value is an object', () => {
    expect(sanitizeMeta({ error: { message: 'x', password: 'p' }, count: 1 })).toEqual({ count: 1 });
  });
});

describe('logger output', () => {
  let output: string;
  let stream: winston.transports.StreamTransportInstance;
  let silenced: winston.transport[];

  beforeEach(() => {
    output = '';
    stream = new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _enc, cb) {
          output += chunk.toString();
          cb();
        }
      })
    });
    silenced = [...logger.transports];
    silenced.forEach(t => {
      t.silent = true;
    });
    logger.add(stream);
  });

  afterEach(() => {
    logger.remove(stream);
    silenced.forEach(t => {
      t.silent = false;
    });
  });

  it('prints allowed metadata after the message', () => {
    logger.error('Failed to mark email as sent', { event_id: 'evt-1', retry_count: 2, error: 'timeout' });

    expect(output).toMatch(/error: Failed to mark email as sent \{.*"event_id":"evt-1".*"retry_count":2.*\}/);
  });

  it('never prints sensitive metadata, whatever the call site passes', () => {
    logger.error('Something failed', {
      event_id: 'evt-1',
      password: 'hunter2',
      new_password: 'Another-Passw0rd!',
      access_token: 'tok-access',
      refresh_token: 'tok-refresh',
      password_hash: '$2a$12$abcdefghijklmnopqrstuv',
      sendgridApiKey: 'SG.key',
      customer_email: 'buyer@example.com',
      customer_phone: '010-1234-5678',
      authorization: 'Bearer abc',
      cookie: 'access_token=zzz',
      body: { content: 'memo text' },
      content: 'private memo',
      reason: 'because',
      s3_key: 'estimates/e1/secret-file.pdf',
      key: 'estimates/e1/other.pdf',
      stack_dump: 'x'
    });

    for (const secret of [
      'hunter2',
      'Another-Passw0rd',
      'tok-access',
      'tok-refresh',
      '$2a$12$',
      'SG.key',
      'buyer@example.com',
      '010-1234-5678',
      'Bearer abc',
      'zzz',
      'memo text',
      'private memo',
      'because',
      'secret-file.pdf',
      'other.pdf'
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('"event_id":"evt-1"');
  });

  it('masks secrets inside the message and inside an error text', () => {
    logger.error('Cannot connect to postgres://admin:TopSecret@db.example.com/app', {
      error: 'rejected recipient owner@example.com with token=abcd1234'
    });

    expect(output).not.toMatch(/TopSecret|owner@example\.com|abcd1234/);
    expect(output).toContain('postgres://admin:***@db.example.com/app');
  });

  it('masks secrets inside a stack trace and cuts a very long message', () => {
    const err = new Error('failed for postgres://u:StackSecret@h/db');
    logger.error(err.message, { error: err.message });
    expect(output).not.toContain('StackSecret');

    output = '';
    logger.error('x'.repeat(MAX_MESSAGE_LENGTH * 3));
    expect(output.length).toBeLessThan(MAX_MESSAGE_LENGTH + 200);
    expect(output).toContain('[truncated]');
  });

  it('logs an Error passed as metadata without leaking its secrets', () => {
    logger.error('Boom', new Error('db url postgres://u:ErrSecret@h/db'));

    expect(output).not.toContain('ErrSecret');
    expect(output).toContain('Boom');
  });

  it('does not print the service name or any unknown key', () => {
    logger.error('Plain message', { surprise: 'value' });

    expect(output).not.toContain('surprise');
    expect(output).not.toContain('bridge-path-mvp');
  });
});
