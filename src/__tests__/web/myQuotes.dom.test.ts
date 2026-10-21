/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { loadPage, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const SCRIPTS = ['config.js', 'customer-auth.js', 'my-quotes.js'];
const RECEIPT = 'BP20261021001';

type Answer = { status: number; body?: unknown };
const ok = (body: unknown = {}): Answer => ({ status: 200, body });
const refuse = (status: number, code: string): Answer => ({ status, body: { code, error: code } });
const CUSTOMER = { id: 'c1', email: 'buyer@example.com', name: '김구매', consent_required: false, phone_required: false };

const QUOTE = {
  version: 2, published_at: '2026-10-22T05:00:00.000Z', currency: 'KRW',
  items: [
    { name: '아세테이트 프레임', quantity: 500, unit_price: 12000, amount: 6000000 },
    { name: '케이스·클리너', quantity: 500, unit_price: 800, amount: 400000 }
  ],
  total_amount: 6400000, fx_currency: 'USD', fx_rate: 1330.79, valid_until: '2099-12-31', expired: false,
  lead_time: '주문 후 약 6주', customer_note: '샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.'
};
const ESTIMATE = { receipt_id: RECEIPT, category: 'eyewear', request_kind: 'detailed', created_at: '2026-10-21T03:00:00.000Z', quantity: 500 };

let loaded: LoadedPage | undefined;
let routes: Record<string, Answer>;
let calls: string[];
let go: jest.Mock;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) {
    await Promise.resolve();
  }
};

async function open(search = ''): Promise<void> {
  g.history.replaceState({}, '', `/my-quotes.html${search}`);
  g.fetch = jest.fn(async (url: string, init: any) => {
    const key = `${init.method} ${String(url).replace('http://localhost:4000/api/customers', '')}`;
    calls.push(key);
    const answer = routes[key] ?? refuse(404, 'NO_ROUTE');
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  });
  loaded = loadPage('my-quotes.html', SCRIPTS);
  go = jest.fn();
  g.BridgePathMyQuotes.go = go;
  await flush();
}

beforeEach(() => {
  calls = [];
  routes = { 'GET /me': ok({ customer: CUSTOMER }), 'GET /me/estimates': ok({ estimates: [] }) };
});

afterEach(() => {
  loaded?.dispose();
  loaded = undefined;
  delete g.BridgePathAuth;
  delete g.BridgePathMyQuotes;
  delete g.BridgePathConfig;
  delete g.fetch;
});

describe('my-quotes.html: who may look', () => {
  it('sends someone who is not signed in to the login page, to come back here', async () => {
    routes['GET /me'] = refuse(401, 'CUSTOMER_AUTH_REQUIRED');

    await open();

    expect(go).toHaveBeenCalledWith('login.html?next=%2Fmy-quotes.html');
    expect(calls).toEqual(['GET /me']);
    expect($('#viewList').hidden).toBe(true);
  });

  it('comes back to the very request that was asked for', async () => {
    routes['GET /me'] = refuse(401, 'CUSTOMER_AUTH_REQUIRED');

    await open(`?r=${RECEIPT}`);

    expect(go).toHaveBeenCalledWith(`login.html?next=${encodeURIComponent(`/my-quotes.html?r=${RECEIPT}`)}`);
  });

  it('asks an account that lacks the consent or the phone to complete it first', async () => {
    routes['GET /me'] = ok({ customer: { ...CUSTOMER, phone_required: true } });

    await open();

    expect(go).toHaveBeenCalledWith('login.html?step=complete&next=%2Fmy-quotes.html');
    expect(calls).toEqual(['GET /me']);
  });

  it('goes to the login page when the session ends meanwhile', async () => {
    routes['GET /me/estimates'] = refuse(401, 'CUSTOMER_AUTH_REQUIRED');

    await open();

    expect(go).toHaveBeenCalledWith('login.html?next=%2Fmy-quotes.html');
  });

  it('sends only the cookie to /api/customers, nothing else', async () => {
    await open();

    expect(g.fetch.mock.calls.every((call: any[]) => call[1].credentials === 'include')).toBe(true);
    expect(g.fetch.mock.calls.every((call: any[]) => String(call[0]).startsWith('http://localhost:4000/api/customers/'))).toBe(true);
  });
});

describe('the list', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    receipt_id: RECEIPT, category: 'eyewear', request_kind: 'detailed', created_at: '2026-10-21T03:00:00.000Z', has_quote: false, ...over
  });

  it('says that the list is empty, and where to start', async () => {
    await open();

    expect($('#viewList').hidden).toBe(false);
    expect($('#listEmpty').hidden).toBe(false);
    expect($('#listEmpty a').getAttribute('href')).toBe('estimate.html');
    expect($('#whoName').textContent).toBe('김구매');
    expect($('#logoutBtn').hidden).toBe(false);
  });

  it('shows each request with its kind, the day and what is going on, in the customer\'s words', async () => {
    routes['GET /me/estimates'] = ok({
      estimates: [
        item({ receipt_id: 'BP20261021003', has_quote: true }),
        item({ receipt_id: 'BP20261021002' }),
        item({ receipt_id: 'BP20261021001', request_kind: 'simple', category: 'shoes' })
      ]
    });

    await open();

    const cards = $$('.mq-card');
    expect(cards.map(card => card.querySelector('strong').textContent)).toEqual(['BP20261021003', 'BP20261021002', 'BP20261021001']);
    expect(cards.map(card => card.querySelector('.mq-card-state').textContent)).toEqual([
      '담당자 상세견적이 도착했어요',
      '담당자가 확인하고 있어요 · 업무일 기준 2~3일 정도 걸릴 수 있어요',
      '접수되었어요'
    ]);
    expect(cards[0].querySelector('.mq-card-state').className).toContain('mq-ready');
    expect(cards[0].querySelector('.mq-badge').textContent).toBe('담당자 상세견적 요청');
    expect(cards[2].querySelector('.mq-badge').textContent).toBe('간단 접수');
    expect(cards[2].querySelector('.mq-card-meta').textContent).toBe('신발 · 2026-10-21 접수');
    expect(cards[0].getAttribute('href')).toBe('my-quotes.html?r=BP20261021003');
    expect($('#listEmpty').hidden).toBe(true);
  });

  it('puts a receipt number from the server in as text, and in the link as an encoded value', async () => {
    routes['GET /me/estimates'] = ok({ estimates: [item({ receipt_id: '<img src=x onerror=alert(1)>&r=2' })] });

    await open();

    expect($('.mq-card img')).toBeNull();
    expect($('.mq-card strong').textContent).toBe('<img src=x onerror=alert(1)>&r=2');
    expect($('.mq-card').getAttribute('href')).toBe('my-quotes.html?r=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E%26r%3D2');
  });

  it('says why when the list cannot be read', async () => {
    routes['GET /me/estimates'] = refuse(500, 'INTERNAL_ERROR');

    await open();

    expect($('#error').hidden).toBe(false);
    expect($('#error').textContent).toBe('문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  });
});

describe('one request', () => {
  const detail = (quote: unknown, estimate: Record<string, unknown> = {}) => ok({ estimate: { ...ESTIMATE, ...estimate }, quote });

  it('shows the published quote: the items, the total, the validity, the lead time, the rate and the note', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail(QUOTE);

    await open(`?r=${RECEIPT}`);

    expect($('#viewDetail').hidden).toBe(false);
    expect($('#viewList').hidden).toBe(true);
    expect($('#detailTitle').textContent).toBe(`접수 ${RECEIPT}`);
    expect($('#detailMeta').textContent).toBe('선글라스·안경 · 500개 · 2026-10-21 접수 · 담당자 상세견적 요청');
    expect($('#waiting').hidden).toBe(true);
    expect($('#quote').hidden).toBe(false);
    expect($('#quoteMeta').textContent).toBe('2026-10-22 작성 · 버전 2');
    expect($$('#quoteItems tr').map(row => Array.from(row.children).map((cell: any) => cell.textContent))).toEqual([
      ['아세테이트 프레임', '500', '12,000원', '6,000,000원'],
      ['케이스·클리너', '500', '800원', '400,000원']
    ]);
    expect($('#quoteTotal').textContent).toBe('6,400,000원');
    expect($$('#quoteFacts dt').map(dt => dt.textContent)).toEqual(['견적 유효기간', '납기 예상', '적용 환율']);
    expect($$('#quoteFacts dd').map(dd => dd.textContent)).toEqual(['2099-12-31까지', '주문 후 약 6주', '1 USD = 1,330.79원']);
    expect($('#noteBox').hidden).toBe(false);
    expect($('#quoteNote').textContent).toBe('샘플 확인 후 확정해 주세요.\n문의는 담당자에게 연락해 주세요.');
    expect($('#helpReceipt').textContent).toBe(RECEIPT);
    expect($('#expired').hidden).toBe(true);
  });

  it('leaves out what the quote does not have', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail({ ...QUOTE, fx_currency: null, fx_rate: null, valid_until: null, lead_time: null, customer_note: null });

    await open(`?r=${RECEIPT}`);

    expect($$('#quoteFacts dt')).toHaveLength(0);
    expect($('#noteBox').hidden).toBe(true);
  });

  it('says when the validity has passed', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail({ ...QUOTE, valid_until: '2020-01-01', expired: true });

    await open(`?r=${RECEIPT}`);

    expect($('#expired').hidden).toBe(false);
    expect($('#quoteFacts dd').textContent).toBe('2020-01-01까지 (지났어요)');
  });

  it('says that the staff are on it, and that it can take 2-3 working days, while there is no quote', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail(null);

    await open(`?r=${RECEIPT}`);

    expect($('#waiting').hidden).toBe(false);
    expect($('#waiting').textContent).toContain('업무일 기준 2~3일 정도 걸릴 수 있어요');
    expect($('#quote').hidden).toBe(true);
  });

  it('does not promise a detailed quote for a simple request', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail(null, { request_kind: 'simple', quantity: null });

    await open(`?r=${RECEIPT}`);

    expect($('#waiting').hidden).toBe(true);
    expect($('#quote').hidden).toBe(true);
    expect($('#detailMeta').textContent).toBe('선글라스·안경 · 2026-10-21 접수 · 간단 접수');
  });

  it('puts what the staff wrote in as text only', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail({
      ...QUOTE,
      items: [{ name: '<img src=x onerror=alert(1)>', quantity: 1, unit_price: 1, amount: 1 }],
      customer_note: '<script>alert(2)</script>',
      lead_time: '<b>6주</b>'
    });

    await open(`?r=${RECEIPT}`);

    expect($('#quote img')).toBeNull();
    expect($('#quote script')).toBeNull();
    expect($('#quote b')).toBeNull();
    expect($('#quoteItems td').textContent).toBe('<img src=x onerror=alert(1)>');
    expect($('#quoteNote').textContent).toBe('<script>alert(2)</script>');
  });

  it('says so, with a way back, when the request is not found (or is not the customer\'s)', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = refuse(404, 'ESTIMATE_NOT_FOUND');

    await open(`?r=${RECEIPT}`);

    expect($('#viewDetail').hidden).toBe(true);
    expect($('#error').textContent).toContain('찾을 수 없는 견적이에요');
    expect($('#error a').getAttribute('href')).toBe('my-quotes.html');
  });

  it('asks for the request by the receipt number encoded in the address', async () => {
    await open(`?r=${encodeURIComponent('BP1/../x')}`);

    expect(calls).toContain('GET /me/estimates/BP1%2F..%2Fx');
  });

  it('never shows an internal status or a word of the staff', async () => {
    routes[`GET /me/estimates/${RECEIPT}`] = detail(QUOTE);

    await open(`?r=${RECEIPT}`);

    expect(g.document.body.textContent).not.toMatch(/new_receipt|under_review|quoted|factory_checking|memo|admin/i);
  });
});

describe('signing out', () => {
  it('ends the session and goes to the home page', async () => {
    routes['POST /logout'] = ok({ message: 'Signed out' });
    await open();

    $('#logoutBtn').click();
    await flush();

    expect(calls).toContain('POST /logout');
    expect(go).toHaveBeenCalledWith('index.html');
  });
});

describe('my-quotes.html and its script (what is in the files)', () => {
  const ROOT = path.join(__dirname, '..', '..', '..');
  const html = fs.readFileSync(path.join(ROOT, 'my-quotes.html'), 'utf8');
  const code = fs.readFileSync(path.join(ROOT, 'my-quotes.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('loads config.js, the account logic and the page script, and asks not to be indexed', () => {
    expect([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1])).toEqual(SCRIPTS);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('keeps every id once', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds no markup from strings, keeps nothing in the browser, and does not fetch by itself', () => {
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|alert\(|confirm\(|prompt\(/);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest/);
  });

  it('is linked from the home page', () => {
    expect(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')).toContain('href="my-quotes.html"');
  });
});
