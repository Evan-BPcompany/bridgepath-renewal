/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const preview = require('../../../estimate-market-preview.js');

const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const answer = (status: number, body: unknown) => ({ status, json: async () => body });

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}

function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

const SHOES_RANGE = {
  available: true,
  currency: 'KRW',
  quantity: 600,
  unit: 'pair',
  unit_price: { min: 11600, max: 17400 },
  total_price: { min: 6960000, max: 10440000 }
};

afterAll(() => {
  delete g.BridgePathMarketPreview;
});

describe('the pure helpers', () => {
  it('reads a whole quantity from 1 to 1,000,000 and nothing else', () => {
    expect(preview.parseQuantity('600')).toBe(600);
    expect(preview.parseQuantity(' 1000000 ')).toBe(1000000);
    for (const bad of ['', '0', '-1', '1.5', '1000001', 'abc', '1e3', undefined, null]) {
      expect(preview.parseQuantity(bad)).toBeNull();
    }
  });

  it('builds the request: the shoe type as the category, the golf tee as golf_tee, and only three values', () => {
    expect(preview.readInput('shoes', 'boots', { material: 'leather', quantity: '600' })).toEqual({ category: 'boots', material: 'leather', quantity: 600 });
    expect(preview.readInput('golf', '', { material: 'wood', quantity: '1000' })).toEqual({ category: 'golf_tee', material: 'wood', quantity: 1000 });
    expect(preview.readInput('shoes', 'boots', { material: '', quantity: '600' })).toBeNull();
    expect(preview.readInput('shoes', 'boots', { material: 'leather', quantity: '' })).toBeNull();
    expect(preview.readInput('sunglasses', 'optical', { material: 'metal', quantity: '600' })).toBeNull();
  });

  it('shows a range per pair for shoes and per package of 50 for golf tees', () => {
    const shoes = preview.interpret('shoes', 200, SHOES_RANGE);
    const golf = preview.interpret('golf', 200, { ...SHOES_RANGE, unit: 'package', unit_price: { min: 890, max: 1490 }, total_price: { min: 890000, max: 1490000 } });

    expect(shoes.kind).toBe('range');
    expect(shoes.lines[0]).toBe('켤레당 약 11,600원 ~ 17,400원');
    expect(shoes.lines[1]).toBe('총 약 6,960,000원 ~ 10,440,000원');
    expect(golf.lines[0]).toBe('1패키지(50개입)당 약 890원 ~ 1,490원');
    expect(shoes.lines[2]).toContain('확정 견적이 아닙니다');
  });

  it('says the minimum order below it, a busy line on 429 and a failure line otherwise', () => {
    expect(preview.interpret('shoes', 200, { available: false, reason: 'BELOW_MINIMUM', minimum_quantity: 600 })).toEqual({ kind: 'minimum', lines: ['최소 주문 수량은 600켤레예요.'] });
    expect(preview.interpret('golf', 200, { available: false, reason: 'BELOW_MINIMUM' }).lines[0]).toContain('1,000패키지');
    expect(preview.interpret('shoes', 429, null).kind).toBe('busy');
    expect(preview.interpret('shoes', 500, null).kind).toBe('failed');
    expect(preview.interpret('shoes', 200, { available: false, reason: 'NO_BASE_PRICE' }).kind).toBe('unavailable');
    expect(preview.interpret('shoes', 200, 'text').kind).toBe('failed');
  });

  it('asks the API once, with JSON, and gives back a status 0 when the network fails', async () => {
    const doFetch = jest.fn().mockResolvedValue(answer(200, SHOES_RANGE));

    const ok = await preview.requestPreview('http://localhost:4000/', { category: 'boots', material: 'leather', quantity: 600 }, doFetch);

    expect(doFetch.mock.calls[0][0]).toBe('http://localhost:4000/api/estimate-preview');
    expect(doFetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"category":"boots","material":"leather","quantity":600}' });
    expect(ok).toEqual({ status: 200, body: SHOES_RANGE });
    expect(await preview.requestPreview('', {}, jest.fn().mockRejectedValue(new Error('offline')))).toEqual({ status: 0, body: null });
  });
});

describe.each([
  ['shoes', 'shoes-estimate.html', 'sneakers', 'leather', '600', '599'],
  ['golf', 'golf-estimate.html', 'golf_tee', 'wood', '1000', '999']
])('the price box of the %s page', (page, file, card, material, minimum, below) => {
  let loaded: LoadedPage | undefined;
  let fetchMock: jest.Mock;

  const open = (): void => {
    loaded = loadPage(file, [...PAGE_SCRIPTS(page), 'estimate-market-preview.js']);
    g.document.querySelector(`.category-card[data-category="${card}"]`).click();
  };
  const settle = async (): Promise<void> => {
    jest.advanceTimersByTime(600);
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn().mockResolvedValue(answer(200, { ...SHOES_RANGE, quantity: Number(minimum) }));
    g.fetch = fetchMock;
    g.scrollTo = jest.fn();
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
    jest.useRealTimers();
    delete g.fetch;
  });

  it('is hidden at first and stays hidden until the material and the quantity are given', async () => {
    open();

    expect($('#marketPreview').hidden).toBe(true);
    choose($('#material'), material);
    await settle();
    expect($('#marketPreview').hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for the range once the two are given, and shows it as text', async () => {
    open();

    choose($('#material'), material);
    type($('#quantity'), minimum);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toEqual({ category: page === 'golf' ? 'golf_tee' : card, material, quantity: Number(minimum) });
    expect($('#marketPreview').hidden).toBe(false);
    expect($('#marketPreview').getAttribute('data-kind')).toBe('range');
    expect($('#marketPreview').textContent).toContain('약 11,600원 ~ 17,400원');
    expect($('#marketPreview img')).toBeNull();
  });

  it('says the minimum at once below it, without asking the server', async () => {
    open();

    choose($('#material'), material);
    type($('#quantity'), below);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#marketPreview').getAttribute('data-kind')).toBe('minimum');
    expect($('#marketPreview').textContent).toContain('최소 주문 수량');
  });

  it('waits for the typing to stop: one question for a number typed in several steps', async () => {
    open();
    choose($('#material'), material);

    for (const partial of ['1', '10', '100', minimum]) {
      type($('#quantity'), partial);
    }
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a short line when the server fails, and never blocks the form', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    open();

    choose($('#material'), material);
    type($('#quantity'), minimum);
    await settle();

    expect($('#marketPreview').getAttribute('data-kind')).toBe('failed');
    expect($('#marketPreview').textContent).toContain('정식 견적 요청은 그대로 진행할 수 있어요');
    expect($('#nextBtn2').disabled).toBe(false);
  });

  it('puts what the server says in as text, never as markup', async () => {
    fetchMock.mockResolvedValue(answer(200, { ...SHOES_RANGE, notice: '<img src=x onerror=alert(1)>', unit_price: { min: 1, max: 2 } }));
    open();

    choose($('#material'), material);
    type($('#quantity'), minimum);
    await settle();

    expect($('#marketPreview img')).toBeNull();
  });
});
