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
let bodies: Array<{ key: string; body: any }>;
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
    bodies.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
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
  bodies = [];
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

// The staff member's contact, the short questions and the request for a consultation.
describe('asking about the quote', () => {
  const QUOTE_WITH_CONTACT = { ...QUOTE, contact: { name: '김담당', email: 'staff@bridgepath.co.kr', phone: '010-1234-5678' } };
  const INQ = (over: Record<string, unknown> = {}) => ({
    id: 'i1', kind: 'question', quote_version: 2, body: '납기를 2주 줄일 수 있나요?', phone: null, preferred_time: null, status: 'open',
    answer: null, created_at: '2026-10-22T05:00:00.000Z', handled_at: null, ...over
  });
  const detail = (quote: unknown, inquiries: unknown[] = []) => ok({ estimate: ESTIMATE, quote, inquiries });
  const bodiesOf = (key: string): any[] => bodies.filter(item => item.key === key).map(item => item.body);
  const PATH = `GET /me/estimates/${RECEIPT}`;
  const POST = `POST /me/estimates/${RECEIPT}/inquiries`;
  const type = (selector: string, value: string): void => {
    const element = $(selector);
    element.value = value;
    element.dispatchEvent(new g.Event('input', { bubbles: true }));
  };
  const submit = (selector: string): void => $(selector).dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));

  describe('the contact', () => {
    it('shows the staff member with a link to write and to call, from the quote', async () => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT);

      await open(`?r=${RECEIPT}`);

      expect($('#contactBox').hidden).toBe(false);
      expect($$('#contactFacts dt').map(dt => dt.textContent)).toEqual(['이름', '이메일', '전화']);
      expect($('#contactFacts a[href^="mailto:"]').getAttribute('href')).toBe('mailto:staff@bridgepath.co.kr');
      expect($('#contactFacts a[href^="tel:"]').getAttribute('href')).toBe('tel:01012345678');
      expect($('#contactFacts dd').textContent).toBe('김담당');
    });

    it('is not shown for a quote published before it had a contact', async () => {
      routes[PATH] = detail(QUOTE);

      await open(`?r=${RECEIPT}`);

      expect($('#contactBox').hidden).toBe(true);
    });

    it('makes a link only of what looks like an address or a number, and puts the rest in as text', async () => {
      routes[PATH] = detail({ ...QUOTE, contact: { name: '<b>김</b>', email: 'javascript:alert(1)', phone: '<img src=x>' } });

      await open(`?r=${RECEIPT}`);

      expect($('#contactFacts a')).toBeNull();
      expect($('#contactFacts b')).toBeNull();
      expect($('#contactFacts img')).toBeNull();
      expect($$('#contactFacts dd').map(dd => dd.textContent)).toEqual(['<b>김</b>', 'javascript:alert(1)', '<img src=x>']);
    });
  });

  describe('who can ask', () => {
    it('is shown under a published quote, and not before one', async () => {
      routes[PATH] = detail(null);
      await open(`?r=${RECEIPT}`);
      expect($('#askBox').hidden).toBe(true);
      loaded?.dispose();

      routes[PATH] = detail(QUOTE_WITH_CONTACT);
      await open(`?r=${RECEIPT}`);
      expect($('#askBox').hidden).toBe(false);
      expect($('#questionForm').hidden).toBe(false);
      expect($('#questionText').getAttribute('maxlength')).toBe('300');
      expect($('#questionCounter').textContent).toBe('0 / 300');
    });
  });

  describe('a short question', () => {
    beforeEach(() => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT);
    });

    it('counts the characters as they are typed, a Korean letter as one', async () => {
      await open(`?r=${RECEIPT}`);

      type('#questionText', '납기를 줄일 수 있나요?');

      expect($('#questionCounter').textContent).toBe('13 / 300');
    });

    it('asks for a text before it sends anything', async () => {
      await open(`?r=${RECEIPT}`);

      submit('#questionForm');
      await flush();

      expect($('#questionError').textContent).toBe('질문을 적어 주세요.');
      expect(bodiesOf(POST)).toEqual([]);
    });

    it('refuses 301 characters (the page stops at 300, the check is for a pasted text)', async () => {
      await open(`?r=${RECEIPT}`);
      $('#questionText').removeAttribute('maxlength');

      type('#questionText', '가'.repeat(301));
      submit('#questionForm');
      await flush();

      expect($('#questionError').textContent).toBe('300자 이내로 적어 주세요.');
      expect(bodiesOf(POST)).toEqual([]);
    });

    it('sends the question, empties the box and shows it with "waiting for an answer"', async () => {
      routes[POST] = { status: 201, body: { inquiry: INQ() } };
      await open(`?r=${RECEIPT}`);
      routes[PATH] = detail(QUOTE_WITH_CONTACT, [INQ()]);

      type('#questionText', '  납기를 2주 줄일 수 있나요?  ');
      submit('#questionForm');
      await flush();

      expect(bodiesOf(POST)).toEqual([{ kind: 'question', body: '납기를 2주 줄일 수 있나요?' }]);
      expect($('#questionText').value).toBe('');
      expect($$('.mq-thread-item')).toHaveLength(1);
      expect($('.mq-thread-item .mq-text').textContent).toBe('납기를 2주 줄일 수 있나요?');
      expect($('.mq-thread-item .mq-pending').textContent).toBe('답변을 기다리고 있어요');
      expect($('#questionForm').hidden).toBe(true);
      expect($('#questionWaiting').hidden).toBe(false);
    });

    it('shows the answer of the staff, and lets the customer ask again', async () => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT, [
        INQ({ status: 'answered', answer: '가능합니다.\n수량이 500개 이상이면요.', handled_at: '2026-10-23T01:00:00.000Z' })
      ]);

      await open(`?r=${RECEIPT}`);

      expect($('.mq-thread-item').textContent).toContain('담당자 답변 · 2026-10-23');
      expect($('.mq-answer').textContent).toBe('가능합니다.\n수량이 500개 이상이면요.');
      expect($('.mq-pending')).toBeNull();
      expect($('#questionForm').hidden).toBe(false);
      expect($('#questionWaiting').hidden).toBe(true);
    });

    it('lists the questions newest first, as text only', async () => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT, [
        INQ({ id: 'a', body: '첫 질문', status: 'answered', answer: '<script>alert(1)</script>', handled_at: '2026-10-22T06:00:00.000Z' }),
        INQ({ id: 'b', body: '<img src=x onerror=alert(2)>', created_at: '2026-10-23T05:00:00.000Z' })
      ]);

      await open(`?r=${RECEIPT}`);

      expect($$('.mq-thread-item .mq-text').map(item => item.textContent)).toEqual(['<img src=x onerror=alert(2)>', '첫 질문', '<script>alert(1)</script>']);
      expect($('.mq-thread img')).toBeNull();
      expect($('.mq-thread script')).toBeNull();
    });

    it.each([
      ['ALREADY_OPEN', 409, '앞서 남기신 것이 아직 처리되지 않았어요'],
      ['TOO_MANY', 429, '더 이상 남길 수 없어요'],
      ['NO_QUOTE', 409, '게시된 뒤에 남길 수 있어요']
    ])('says why with %s, and keeps what was typed', async (code, status, text) => {
      routes[POST] = refuse(status, code);
      await open(`?r=${RECEIPT}`);

      type('#questionText', '질문입니다');
      submit('#questionForm');
      await flush();

      expect($('#questionError').textContent).toContain(text);
      expect($('#questionText').value).toBe('질문입니다');
      expect($('#questionSubmit').disabled).toBe(false);
    });

    it('sends one at a time', async () => {
      let release!: () => void;
      routes[POST] = { status: 201, body: { inquiry: INQ() } };
      await open(`?r=${RECEIPT}`);
      const original = g.fetch;
      g.fetch = jest.fn(
        (url: string, init: any) => (init.method === 'POST' ? new Promise(resolve => { release = () => resolve({ ok: true, status: 201, json: async () => ({ inquiry: INQ() }) }); }) : original(url, init))
      );

      type('#questionText', '질문입니다');
      submit('#questionForm');
      submit('#questionForm');
      await flush();

      expect(g.fetch.mock.calls.filter((call: any[]) => call[1].method === 'POST')).toHaveLength(1);
      expect($('#questionSubmit').disabled).toBe(true);
      release();
      await flush();
    });
  });

  describe('a request for a consultation', () => {
    beforeEach(() => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT);
    });

    it('opens a form with the phone of the account, and closes it again', async () => {
      routes['GET /me'] = ok({ customer: { ...CUSTOMER, phone: '010-1234-5678' } });
      await open(`?r=${RECEIPT}`);
      expect($('#consultForm').hidden).toBe(true);

      $('#consultOpen').click();

      expect($('#consultForm').hidden).toBe(false);
      expect($('#consultOpen').hidden).toBe(true);
      expect($('#consultPhone').value).toBe('010-1234-5678');

      $('#consultCancel').click();
      expect($('#consultForm').hidden).toBe(true);
      expect($('#consultOpen').hidden).toBe(false);
    });

    it('checks the phone before it sends', async () => {
      await open(`?r=${RECEIPT}`);
      $('#consultOpen').click();

      type('#consultPhone', '');
      submit('#consultForm');
      expect($('#consultError').textContent).toBe('휴대폰 번호를 입력해 주세요.');
      type('#consultPhone', 'call me');
      submit('#consultForm');
      expect($('#consultError').textContent).toContain('전화번호는 숫자 7~15자리');
      expect(bodiesOf(POST)).toEqual([]);
    });

    it('sends the phone, the time and the note, and shows that the staff will call', async () => {
      routes[POST] = { status: 201, body: { inquiry: INQ({ kind: 'consultation' }) } };
      await open(`?r=${RECEIPT}`);
      routes[PATH] = detail(QUOTE_WITH_CONTACT, [
        INQ({ kind: 'consultation', body: '납기 이야기', phone: '010-9999-8888', preferred_time: 'weekday_pm' })
      ]);
      $('#consultOpen').click();

      type('#consultPhone', ' 010-9999-8888 ');
      $('#consultTime').value = 'weekday_pm';
      type('#consultNote', ' 납기 이야기 ');
      submit('#consultForm');
      await flush();

      expect(bodiesOf(POST)).toEqual([{ kind: 'consultation', phone: '010-9999-8888', preferred_time: 'weekday_pm', body: '납기 이야기' }]);
      expect($('#consultState').hidden).toBe(false);
      expect($('#consultState').textContent).toContain('심층상담을 요청했어요');
      expect($('#consultState').textContent).toContain('010-9999-8888');
      expect($('#consultState').textContent).toContain('평일 오후');
      expect($('#consultState').textContent).toContain('납기 이야기');
      expect($('#consultOpen').hidden).toBe(true);
      expect($('#consultForm').hidden).toBe(true);
    });

    it('leaves the note out when there is none', async () => {
      routes[POST] = { status: 201, body: { inquiry: INQ({ kind: 'consultation' }) } };
      await open(`?r=${RECEIPT}`);
      $('#consultOpen').click();

      type('#consultPhone', '010-1234-5678');
      submit('#consultForm');
      await flush();

      expect(bodiesOf(POST)).toEqual([{ kind: 'consultation', phone: '010-1234-5678', preferred_time: 'any' }]);
    });

    it('says "done" for a consultation that is over, and lets the customer ask for another', async () => {
      routes[PATH] = detail(QUOTE_WITH_CONTACT, [
        INQ({ kind: 'consultation', status: 'done', body: null, phone: '010-1234-5678', preferred_time: 'any', answer: '다음 주에 샘플 보내기로 함', handled_at: '2026-10-24T02:00:00.000Z' })
      ]);

      await open(`?r=${RECEIPT}`);

      expect($('#consultState').textContent).toContain('지난 심층상담이 끝났어요 · 2026-10-24');
      expect($('#consultState').textContent).toContain('다음 주에 샘플 보내기로 함');
      expect($('#consultOpen').hidden).toBe(false);
    });

    it('says why with ALREADY_OPEN and keeps the form', async () => {
      routes[POST] = refuse(409, 'ALREADY_OPEN');
      await open(`?r=${RECEIPT}`);
      $('#consultOpen').click();

      type('#consultPhone', '010-1234-5678');
      submit('#consultForm');
      await flush();

      expect($('#consultError').textContent).toContain('아직 처리되지 않았어요');
      expect($('#consultForm').hidden).toBe(false);
    });

    it('refuses a note over 300 characters', async () => {
      await open(`?r=${RECEIPT}`);
      $('#consultOpen').click();
      $('#consultNote').removeAttribute('maxlength');

      type('#consultPhone', '010-1234-5678');
      type('#consultNote', '가'.repeat(301));
      submit('#consultForm');

      expect($('#consultError').textContent).toBe('메모는 300자 이내로 적어 주세요.');
      expect(bodiesOf(POST)).toEqual([]);
    });
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
