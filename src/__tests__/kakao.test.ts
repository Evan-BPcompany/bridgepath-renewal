jest.mock('../config/database', () => ({ getPool: jest.fn() }));

import { config, parseKakao } from '../config/env';
import { getPool } from '../config/database';
import {
  KAKAO_TEMPLATES,
  KAKAO_TEMPLATE_CODES,
  maskPhone,
  normalizeKoreanMobile,
  renderKakaoMessage
} from '../utils/kakaoMessage';
import { processPendingKakaoEvents, queueKakaoInTransaction, setKakaoSender } from '../services/kakaoService';

describe('the Korean mobile number', () => {
  it.each([
    ['010-1234-5678', '01012345678'],
    ['010 1234 5678', '01012345678'],
    ['(010) 1234-5678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'],
    ['0082-10-1234-5678', '01012345678'],
    ['011-234-5678', '0112345678'],
    ['016-1234-5678', '01612345678']
  ])('turns %s into %s', (input, expected) => {
    expect(normalizeKoreanMobile(input)).toBe(expected);
  });

  it.each(['02-123-4567', '031-123-4567', '+1 415 555 0100', '010-123-456', '010-12345-67890', '12345', '', 'abc', '010-1234-567a'])(
    'refuses %s: it cannot receive a KakaoTalk notice',
    input => {
      expect(normalizeKoreanMobile(input)).toBeUndefined();
    }
  );

  it('refuses what is not text, and masks the middle for the log', () => {
    expect(normalizeKoreanMobile(undefined)).toBeUndefined();
    expect(normalizeKoreanMobile(1012345678)).toBeUndefined();
    expect(maskPhone('01012345678')).toBe('010****78');
    expect(maskPhone('123')).toBe('****');
  });
});

describe('the texts of the notices', () => {
  it('has one template for each code, each filling only the receipt number, with a button, and no amount', () => {
    expect(Object.keys(KAKAO_TEMPLATES).sort()).toEqual([...KAKAO_TEMPLATE_CODES].sort());
    for (const code of KAKAO_TEMPLATE_CODES) {
      const template = KAKAO_TEMPLATES[code];
      expect(template.text.match(/#\{[a-z_]+\}/g)).toEqual(['#{receipt_id}']);
      expect(template.text.length).toBeLessThanOrEqual(1000);
      expect(template.button.length).toBeGreaterThan(0);
      expect(template.text).not.toMatch(/원|₩|\d{3},\d{3}/);
    }
  });

  it('fills the receipt number and carries the link for the button', () => {
    const message = renderKakaoMessage('receipt', { receipt_id: 'BP20260101001', link: 'https://app.example.com/my-quotes.html?r=BP20260101001' });

    expect(message.text).toContain('BP20260101001');
    expect(message.text).not.toContain('#{');
    expect(message.link).toBe('https://app.example.com/my-quotes.html?r=BP20260101001');
  });
});

describe('the setting', () => {
  it('is off unless it is switched on, and the only provider is the log', () => {
    expect(parseKakao({}, 'development')).toEqual({ enabled: false, provider: 'log', intervalMs: 30000 });
    expect(parseKakao({ KAKAO_NOTIFY_ENABLED: 'true' }, 'development').enabled).toBe(true);
    expect(parseKakao({ KAKAO_NOTIFY_ENABLED: 'yes' }, 'development').enabled).toBe(false);
    expect(() => parseKakao({ KAKAO_PROVIDER: 'solapi' }, 'development')).toThrow('KAKAO_PROVIDER');
  });

  it('refuses to be on in production: no real sending agency is connected, the log one sends nothing', () => {
    expect(() => parseKakao({ KAKAO_NOTIFY_ENABLED: 'true' }, 'production')).toThrow('not possible in production');
    expect(parseKakao({}, 'production').enabled).toBe(false);
  });

  it('takes a sensible interval only', () => {
    expect(parseKakao({ KAKAO_WORKER_INTERVAL_MS: '5000' }, 'test').intervalMs).toBe(5000);
    expect(parseKakao({ KAKAO_WORKER_INTERVAL_MS: '5' }, 'test').intervalMs).toBe(30000);
    expect(parseKakao({ KAKAO_WORKER_INTERVAL_MS: 'x' }, 'test').intervalMs).toBe(30000);
  });
});

describe('queueing a notice (unit, with a fake connection)', () => {
  const input = { customerId: 'c1', estimateId: 'e1', template: 'receipt' as const, receiptId: 'BP20260101001', key: 'kakao-receipt-e1' };
  let saved: boolean;
  const client = { query: jest.fn() };

  const customerRow = (row: Record<string, unknown> | undefined) => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM customers')) {
        return { rows: row ? [row] : [] };
      }
      return { rowCount: 1, rows: [] };
    });
  };
  const queue = (over: Record<string, unknown> = {}) => queueKakaoInTransaction(client as never, { ...input, ...over });
  const inserts = () => client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO kakao_events'));

  beforeEach(() => {
    saved = config.kakao.enabled;
    config.kakao.enabled = true;
  });
  afterEach(() => {
    config.kakao.enabled = saved;
  });

  it('writes the notice for a customer who agreed and has a Korean mobile number, with the number normalised', async () => {
    customerRow({ phone: '010-1234-5678', kakao_notify_consent_at: new Date() });

    expect(await queue()).toBe(true);
    const [sql, params] = inserts()[0];
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(params[2]).toBe('01012345678');
    expect(params[3]).toBe('receipt');
    expect(JSON.parse(params[4]).receipt_id).toBe('BP20260101001');
    expect(params[5]).toBe('kakao-receipt-e1');
  });

  it.each([
    ['has not agreed', { phone: '01012345678', kakao_notify_consent_at: null }],
    ['has a landline', { phone: '02-123-4567', kakao_notify_consent_at: new Date() }],
    ['has no number', { phone: null, kakao_notify_consent_at: new Date() }],
    ['is not there or not active', undefined]
  ])('writes nothing for a customer who %s', async (_name, row) => {
    customerRow(row as Record<string, unknown> | undefined);

    expect(await queue()).toBe(false);
    expect(inserts()).toHaveLength(0);
  });

  it('writes nothing, and does not even look, when the notices are off or there is no account', async () => {
    customerRow({ phone: '01012345678', kakao_notify_consent_at: new Date() });

    config.kakao.enabled = false;
    expect(await queue()).toBe(false);
    config.kakao.enabled = true;
    expect(await queue({ customerId: null })).toBe(false);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('says false when the same notice was already written (the key is the same)', async () => {
    client.query.mockReset();
    client.query.mockImplementation(async (sql: string) =>
      sql.includes('FROM customers') ? { rows: [{ phone: '01012345678', kakao_notify_consent_at: new Date() }] } : { rowCount: 0, rows: [] }
    );

    expect(await queue()).toBe(false);
  });
});

describe('sending (unit, with a fake pool and a fake agency)', () => {
  const event = { id: 'k1', recipient_phone: '01012345678', template_code: 'receipt', variables: { receipt_id: 'BP1', link: 'https://x.example/m' }, retry_count: 0 };
  const calls: Array<[string, unknown[] | undefined]> = [];

  const poolWith = (events: unknown[]) => {
    calls.length = 0;
    const client = {
      query: jest.fn(async (sql: string) => (sql.includes('SELECT id, recipient_phone') ? { rows: events } : { rows: [] })),
      release: jest.fn()
    };
    (getPool as jest.Mock).mockReturnValue({
      connect: async () => client,
      query: async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [], rowCount: 0 };
      }
    });
  };
  const updates = () => calls.map(([sql]) => sql).filter(sql => sql.includes('UPDATE kakao_events'));

  it('sends with the text, the number and the link, and marks the event sent', async () => {
    poolWith([event]);
    const send = jest.fn().mockResolvedValue('agency-1');
    setKakaoSender({ send });

    expect(await processPendingKakaoEvents()).toBe(1);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ phone: '01012345678', templateCode: 'receipt', link: 'https://x.example/m', button: expect.any(String) }));
    expect(send.mock.calls[0][0].text).toContain('BP1');
    expect(calls.some(([sql, params]) => sql.includes("status = 'sent'") && params?.[1] === 'agency-1')).toBe(true);
  });

  it('puts a failed one back with a delay of 1, 2 and 4 minutes, and then leaves it failed', async () => {
    const fail = { send: jest.fn().mockRejectedValue(new Error('agency down')) };
    setKakaoSender(fail);
    const delays: unknown[] = [];

    for (const retry of [0, 1, 2, 3]) {
      poolWith([{ ...event, retry_count: retry }]);
      await processPendingKakaoEvents();
      const last = calls.filter(([sql]) => sql.includes('UPDATE kakao_events')).pop()!;
      delays.push(last[0].includes("status = 'failed'") ? 'failed' : last[1]![2]);
    }

    expect(delays).toEqual([1, 2, 4, 'failed']);
  });

  it('does nothing when nothing is waiting', async () => {
    poolWith([]);
    const send = jest.fn();
    setKakaoSender({ send });

    expect(await processPendingKakaoEvents()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(updates().every(sql => sql.includes('Recovered'))).toBe(true);
  });
});
