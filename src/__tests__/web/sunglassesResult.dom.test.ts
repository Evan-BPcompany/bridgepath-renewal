/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, readRoot, LoadedPage } from './domHarness';

// The sunglasses quote (2026-11-18): the same flow as the golf shoe (photo only, result screen, specification in the detailed quote of a
// signed-in customer), with the cost simulation of the parts on the result screen.

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const resultApi = require('../../../sunglasses-result.js');

const ANALYSIS = {
  is_sunglasses: true,
  frame_material: 'plastic',
  lens_type: 'mirror',
  frame: 'tr90',
  lens: 'unknown',
  mirror: true,
  gradient: false,
  photochromic: false,
  confidence: 'medium',
  summary: '미러 렌즈의 스포츠 선글라스예요.',
  frame_shape: '랩어라운드',
  frame_color: '블랙',
  complexity: 'medium',
  overview: 'TR90 프레임의 랩어라운드 스포츠 선글라스입니다.',
  details: { frame: 'TR90 프레임', lens: '미러 코팅 렌즈', decoration: '사진으로 확인되지 않아요' },
  cost_factors: ['미러 코팅', '랩어라운드 렌즈'],
  recommendations: ['일반 렌즈로 바꾸면 원가 절감'],
  unconfirmed: ['렌즈 소재', '편광 여부']
};

const COST_ANSWER = {
  spec: {},
  unit: 'piece',
  simulation: {
    unconfirmed: ['lens'],
    currency: 'USD',
    frame_cost: { low: 1.15, high: 1.15 },
    lens_cost: { low: 0.66, high: 1.08 },
    other_cost: 0.6,
    unit_cost: { low: 2.41, high: 2.83 },
    total_cost: { low: 2410, high: 2830 },
    quantity: 1000,
    unit_krw: { low: 3200, high: 3700 },
    total_krw: { low: 3200000, high: 3700000 },
    estimate_type: 'simulation'
  },
  supplier_reference: { status: 'ok', low: 2, high: 4.6, unit_krw: { low: 2600, high: 6100 }, notice: '같은 프레임 소재 선글라스의 공개 공급가격(완제품, 공장 마진 포함)으로, 위 예상 제조원가와 기준이 다릅니다.' },
  domestic: { status: 'insufficient', reason: '국내 기준은 상세견적이 필요한 사양입니다.' },
  assumptions: ['렌즈 소재와 편광 여부는 사진으로 확인할 수 없어 가능한 렌즈 전체의 범위로 계산했습니다. 렌즈를 선택하면 다시 계산합니다.'],
  notice: '가상견적입니다. 프레임·렌즈·기타 비용을 나눠 계산한 예상 제조원가이며, 실제 공장 견적이나 공급업체 판매가격이 아닙니다.'
};

const CUSTOMER = { name: '김구매', email: 'buyer@example.com', phone: '010-1234-5678', company_name: 'ACME', customer_type: 'business_brand' };

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-image');
const isCost = (url: string): boolean => url.endsWith('/api/estimate-preview/sunglasses-cost');
const isEstimate = (url: string): boolean => url.endsWith('/api/estimates');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'golf-shoe-photo.js', 'sunglasses-result.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
let imageInput: any;
let me: jest.Mock;

const settle = async (ms = 400): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};
const costCalls = (): any[] => fetchMock.mock.calls.filter(call => isCost(call[0]));
const click = (element: any): void => element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));

function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

function tick(element: any, checked: boolean): void {
  element.checked = checked;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

async function openResult(): Promise<void> {
  const file = new g.File([new Uint8Array(100)], 'glasses.png', { type: 'image/png' });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
  await settle(50);
  click($('#nextBtn2'));
  await settle(50);
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.fn().mockImplementation(async (url: string) =>
    isAnalysis(url) ? answer(200, { analysis: ANALYSIS, notice: 'x' }) : isCost(url) ? answer(200, COST_ANSWER) : isEstimate(url) ? answer(201, { id: 'r-1', status: 'received', created_at: '2026-11-18T03:00:00Z' }) : answer(200, {})
  );
  g.fetch = fetchMock;
  g.window.scrollTo = () => undefined;
  g.URL.createObjectURL = () => 'blob:photo';
  g.URL.revokeObjectURL = () => undefined;
  me = jest.fn().mockResolvedValue({ ok: false, status: 401, body: null });
  g.BridgePathAuth = { me };
  loaded = loadPage('sunglasses-estimate.html', SCRIPTS());
  imageInput = $('#sunglassImage');
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.BridgePathAuth;
  delete g.BridgePathGolfShoePhoto;
  delete g.BridgePathSunglassesResult;
  g.document.body.removeAttribute('data-golf-stage');
});

describe('the result screen of the sunglasses quote', () => {
  it('opens with "AI 견적 시작" and shows the photo, the analysis and the recognised frame, lens and options', async () => {
    await openResult();

    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#resultPhoto').getAttribute('src')).toBe('blob:photo');
    expect($('#resultOverview').textContent).toBe(ANALYSIS.overview);
    expect($('#resultComplexity').textContent).toBe('복잡도 · 중간');
    expect($('#resultShape').textContent).toBe('랩어라운드');
    expect([$('#resultFrameText').textContent, $('#resultLensText').textContent, $('#resultOptionsText').textContent]).toEqual(['TR90', '확인 필요 (소재·편광)', '미러 코팅']);
    expect($$('#resultUnconfirmed li').map(item => item.textContent)).toEqual(['렌즈 소재', '편광 여부']);
    expect($$('#resultFactors li').map(item => item.textContent)).toEqual(['미러 코팅', '랩어라운드 렌즈']);
  });

  it('asks the cost simulation of what was recognised, for 1,000 pieces, and shows its nine items', async () => {
    await openResult();

    expect(costCalls()).toHaveLength(1);
    expect(JSON.parse(costCalls()[0][1].body)).toEqual({ frame: 'tr90', lens: 'unknown', mirror: true, gradient: false, photochromic: false, quantity: 1000 });
    expect($('#resultCostTable').hidden).toBe(false);
    expect($('#resultCostFrameName').textContent).toBe('TR90');
    expect($('#resultCostLensName').textContent).toBe('확인 필요 (소재·편광) · 기능: 미러 코팅');
    expect($('#resultCostFrame').textContent).toBe('$1.15');
    expect($('#resultCostLens').textContent).toBe('$0.66 ~ $1.08');
    expect($('#resultCostOther').textContent).toBe('$0.60');
    expect($('#resultCostUnit').textContent).toBe('$2.41 ~ $2.83 (약 3,200원 ~ 3,700원)');
    expect($('#resultQuantity').value).toBe('1000');
    expect($('#resultCostTotal').textContent).toBe('$2,410.00 ~ $2,830.00 (약 3,200,000원 ~ 3,700,000원)');
    expect($('#resultNotice').textContent).toBe(COST_ANSWER.notice);
    expect($$('#resultAssumptions li').map(item => item.textContent)).toEqual(COST_ANSWER.assumptions);
  });

  it('shows the public supplier prices apart, as another kind of price, never with a source', async () => {
    await openResult();

    expect($('#resultReference').hidden).toBe(false);
    expect($('#resultReference').textContent).toBe('참고: 같은 프레임 소재 선글라스의 공개 공급가격은 개당 약 $2.00 ~ $4.60입니다. ' + COST_ANSWER.supplier_reference.notice);
    const screen = $('#result-content');
    expect(screen.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    expect(screen.textContent).not.toMatch(/출처|\d+건|Global|globalsources|공급사 \d/);
  });

  it('hides the reference when there is none for the frame', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      isAnalysis(url) ? answer(200, { analysis: ANALYSIS }) : answer(200, { ...COST_ANSWER, supplier_reference: { status: 'insufficient' } })
    );
    await openResult();

    expect($('#resultReference').hidden).toBe(true);
  });

  it('asks the cost again, and not the analysis, when the frame, the lens, an option or the quantity changes', async () => {
    await openResult();

    click($('#resultEditBtn'));
    expect($('#resultFrame').hidden).toBe(false);
    expect($('#resultOptions').hidden).toBe(false);
    choose($('#resultLens'), 'tac_polarized');
    await settle(400);
    tick($('#resultMirror'), false);
    await settle(400);
    $('#resultQuantity').value = '300';
    $('#resultQuantity').dispatchEvent(new g.Event('input', { bubbles: true }));
    await settle(400);

    expect(costCalls()).toHaveLength(4);
    expect(JSON.parse(costCalls()[3][1].body)).toEqual({ frame: 'tr90', lens: 'tac_polarized', mirror: false, gradient: false, photochromic: false, quantity: 300 });
    expect($('#resultRecognitionNote').textContent).toBe(resultApi.TEXTS.edited);
    expect(fetchMock.mock.calls.filter(call => isAnalysis(call[0]))).toHaveLength(1);
  });

  it('says how to fix a quantity that is not a whole number, and asks nothing for it', async () => {
    await openResult();

    $('#resultQuantity').value = '0';
    $('#resultQuantity').dispatchEvent(new g.Event('input', { bubbles: true }));
    await settle(400);

    expect(costCalls()).toHaveLength(1);
    expect($('#resultCostStatus').textContent).toBe(resultApi.TEXTS.quantity);
  });

  it('shows a line and no table when the cost cannot be had', async () => {
    fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? answer(200, { analysis: ANALYSIS }) : answer(500, {})));
    await openResult();

    expect($('#resultCostTable').hidden).toBe(true);
    expect($('#resultCostStatus').textContent).toBe(resultApi.TEXTS.failed);
  });

  it('puts every text in as text, never as markup', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      isAnalysis(url) ? answer(200, { analysis: { ...ANALYSIS, overview: '<img src=x onerror=alert(1)>', unconfirmed: ['<b>x</b>'] } }) : answer(200, COST_ANSWER)
    );
    await openResult();

    expect($('#resultOverview').textContent).toBe('<img src=x onerror=alert(1)>');
    expect($('#result-content img[src="x"]')).toBeNull();
    expect($('#resultUnconfirmed b')).toBeNull();
  });

  it('goes back to the photo with "다른 사진으로 다시 하기"', async () => {
    await openResult();

    click($('#resultBackBtn'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(g.document.body.getAttribute('data-golf-stage')).toBe('photo');
  });
});

describe('the detailed quote of the sunglasses: the specification is asked only after the log in', () => {
  it('asks to log in when the visitor is not signed in, and shows no specification', async () => {
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#detailedLogin').hidden).toBe(false);
    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#specForm').hidden).toBe(true);
  });

  it('shows the specification form filled with what was recognised, for a signed-in customer', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#specForm').hidden).toBe(false);
    expect($('#photoStage').hidden).toBe(true);
    expect($('#step2Title').textContent).toBe(resultApi.TEXTS.specTitle);
    expect($('#frameMaterial').value).toBe('plastic');
    expect($('#lensType').value).toBe('mirror');
    expect($('#frameColor').value).toBe('블랙');
    expect($('#frameMaterial').getAttribute('data-ai-filled')).toBe('true');
    expect($('#quantityHint').textContent).toBe('AI 견적은 1,000개 기준으로 계산했습니다.');
  });

  it('returns to the result, not to step 1, with the back button of the specification', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();
    click($('#detailedBtn'));
    await settle(50);

    click($('#step2Back'));

    expect($('#result-content').classList.contains('active')).toBe(true);
  });

  it('goes on to step 3 and sends a detailed request with the record of what the screen showed', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();
    click($('#detailedBtn'));
    await settle(50);

    $('#quantity').value = '1000';
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
    expect($('#detailedNote').hidden).toBe(false);
    expect($('#customerName').value).toBe('김구매');

    $('#privacyConsent').checked = true;
    click($('#submitBtn'));
    await settle();

    const [, init] = fetchMock.mock.calls.filter(call => isEstimate(call[0]))[0];
    expect(init.credentials).toBe('include');
    // the photo is attached, so the request is one multipart form
    const form = init.body;
    expect(form.get('request_kind')).toBe('detailed');
    expect(form.get('category')).toBe('eyewear');
    expect(form.getAll('files')[0].name).toBe('glasses.png');
    expect(JSON.parse(form.get('specification_json')).ai_preview).toMatchObject({
      source: 'customer_screen',
      analysis: { frame_material: 'plastic', lens_type: 'mirror' },
      price: { currency: 'KRW', quantity: 1000, unit_price: { min: 3200, max: 3700 }, total_price: { min: 3200000, max: 3700000 } }
    });
  });
});

describe('sunglasses-result.js helpers', () => {
  it('reads the spec with "unknown" for an empty select and 1,000 pieces by default', () => {
    expect(resultApi.readSpec({ frame: '', lens: 'pc_polarized', mirror: 1 })).toEqual({ frame: 'unknown', lens: 'pc_polarized', mirror: true, gradient: false, photochromic: false, quantity: 1000 });
  });

  it('turns the answers of the server into what to show', () => {
    expect(resultApi.interpretCost(429, {})).toEqual({ kind: 'busy' });
    expect(resultApi.interpretCost(200, {})).toEqual({ kind: 'failed' });
    expect(resultApi.interpretCost(200, { simulation: COST_ANSWER.simulation }).notice).toBe(resultApi.TEXTS.notice);
  });

  it('turns the recognised frame and lens into the words of the specification form', () => {
    expect(resultApi.specValues('tr90', 'tac_polarized', {})).toEqual({ frameMaterial: 'plastic', lensType: 'polarized' });
    expect(resultApi.specValues('acetate', 'pc_standard', { gradient: true })).toEqual({ frameMaterial: 'acetate', lensType: 'gradient' });
    expect(resultApi.specValues('unknown', 'unknown', {})).toEqual({ frameMaterial: null, lensType: null });
  });

  it('shows one value or a span', () => {
    expect(resultApi.formatSpan({ low: 2.71, high: 2.71 })).toBe('$2.71');
    expect(resultApi.formatSpan({ low: 2.35, high: 2.77 })).toBe('$2.35 ~ $2.77');
  });
});

describe('the markup of the sunglasses result screen', () => {
  it('keeps every id once and lists the nine items of the cost', () => {
    const html = readRoot('sunglasses-estimate.html');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect($$('#resultCostTable th').map(cell => cell.textContent)).toEqual([
      '선택한 프레임 소재', '선택한 렌즈·기능', '프레임 예상 원가', '렌즈 예상 원가', '기타 비용', '개당 예상 제조원가', '생산 수량', '총 예상 제조원가'
    ]);
    expect(html).not.toContain('id="manualBtn"');
  });
});
