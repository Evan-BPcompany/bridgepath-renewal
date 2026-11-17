/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, readRoot, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const resultApi = require('../../../golf-shoe-result.js');

const ANALYSIS = {
  is_golf_shoe: true,
  style: 'sneaker',
  closure: 'dial',
  outsole: 'spikeless',
  upper_material: 'microfiber',
  confidence: 'medium',
  summary: '다이얼로 조이는 스파이크리스 골프화예요.',
  complexity: 'high',
  overview: '다이얼 조임 방식의 스니커형 골프화입니다.',
  details: { upper: '마이크로파이버 어퍼', sole: '스파이크리스 솔', closure: '다이얼 조임', decoration: '사진으로 확인되지 않아요' },
  visible_features: ['다이얼 조임'],
  unconfirmed: ['방수 여부', '중창 소재'],
  cost_factors: ['다이얼 부품', '솔 금형'],
  recommendations: ['일반 레이스로 바꾸면 원가 절감']
};

const RANGE_ANSWER = {
  spec: {},
  unit: 'pair',
  moq: 800,
  overseas: { status: 'ok', currency: 'USD', low: 23.5, high: 32.7, unit_krw: { low: 31100, high: 43300 }, total_krw: { low: 24880000, high: 34640000 } },
  domestic: { status: 'insufficient', currency: 'KRW', reason: '국내 기준은 상세견적이 필요한 사양입니다.' },
  notice: '참고용 범위이며 확정 견적이 아닙니다.'
};

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-golf-shoe');
const isRange = (url: string): boolean => url.endsWith('/api/estimate-preview/golf-shoe-range');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('shoes');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'golf-shoe-photo.js', 'golf-shoe-result.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
let imageInput: any;
let me: jest.Mock;

const settle = async (ms = 400): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};
const rangeCalls = (): any[] => fetchMock.mock.calls.filter(call => isRange(call[0]));
const click = (element: any): void => element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));

function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

// A photo is chosen, analysed, and "AI 견적 시작" pressed: the result screen is up.
async function openResult(): Promise<void> {
  const file = new g.File([new Uint8Array(100)], 'shoe.png', { type: 'image/png' });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
  await settle(50);
  click($('#nextBtn2'));
  await settle(50);
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.fn().mockImplementation(async (url: string) =>
    isAnalysis(url) ? answer(200, { analysis: ANALYSIS, notice: 'x' }) : isRange(url) ? answer(200, RANGE_ANSWER) : answer(200, {})
  );
  g.fetch = fetchMock;
  g.window.scrollTo = () => undefined;
  g.URL.createObjectURL = () => 'blob:photo';
  g.URL.revokeObjectURL = () => undefined;
  me = jest.fn().mockResolvedValue({ ok: false, status: 401, body: null });
  g.BridgePathAuth = { me };
  loaded = loadPage('shoes-estimate.html', SCRIPTS());
  imageInput = $('#shoeImage');
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.BridgePathAuth;
  g.document.body.removeAttribute('data-golf-stage');
});

describe('the result screen of the golf shoe quote', () => {
  it('opens with "AI 견적 시작" instead of going to the specification or to step 3', async () => {
    await openResult();

    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#step2-content').classList.contains('active')).toBe(false);
    expect($('#step3-content').classList.contains('active')).toBe(false);
  });

  it('shows the photo, the overall analysis with its complexity, the recognised values and the side analysis', async () => {
    await openResult();

    expect($('#resultPhoto').getAttribute('src')).toBe('blob:photo');
    expect($('#resultPhotoBox').hidden).toBe(false);
    expect($('#resultOverview').textContent).toBe(ANALYSIS.overview);
    expect($('#resultComplexity').textContent).toBe('복잡도 · 높음');
    expect($('#resultStyle').textContent).toBe('스니커형');
    expect([$('#resultClosureText').textContent, $('#resultOutsoleText').textContent, $('#resultUpperText').textContent]).toEqual(['다이얼 (BOA 등)', '스파이크리스', '마이크로파이버']);
    expect($('#resultDetailUpper').textContent).toBe('마이크로파이버 어퍼');
    expect($$('#resultUnconfirmed li').map(item => item.textContent)).toEqual(['방수 여부', '중창 소재']);
    expect($$('#resultFactors li').map(item => item.textContent)).toEqual(['다이얼 부품', '솔 금형']);
    expect($$('#resultRecommendations li').map(item => item.textContent)).toEqual(['일반 레이스로 바꾸면 원가 절감']);
  });

  it('asks the range for the three recognised values and shows the two ways of production, with the minimum order and the total', async () => {
    await openResult();

    expect(rangeCalls()).toHaveLength(1);
    expect(JSON.parse(rangeCalls()[0][1].body)).toEqual({ outsole: 'spikeless', closure: 'dial', upper_material: 'microfiber' });
    expect($('#resultCostTable').hidden).toBe(false);
    expect($('#resultOverseasUnit').textContent).toContain('31,100원 ~ 43,300원');
    expect($('#resultOverseasUnit small').textContent).toBe('약 $23.5 ~ $32.7');
    expect($('#resultOverseasMoq').textContent).toBe('800켤레');
    expect($('#resultOverseasTotal').textContent).toBe('24,880,000원 ~ 34,640,000원');
    expect($('#resultNotice').textContent).toBe(RANGE_ANSWER.notice);
  });

  it('says that the domestic way needs the detailed quote, in one cell, and shows no number for it', async () => {
    await openResult();

    expect($('#resultDomesticUnit').textContent).toBe('국내 기준은 상세견적이 필요한 사양입니다.');
    expect($('#resultDomesticUnit').rowSpan).toBe(3);
    expect($('#resultDomesticMoq').hidden).toBe(true);
    expect($('#resultDomesticTotal').hidden).toBe(true);
    expect($('#resultCostTable').textContent).not.toMatch(/\d+건|\d+곳|공급사|출처|표시가/);
  });

  it('never shows where the prices come from: no link, no source, no count in the whole screen', async () => {
    await openResult();

    const screen = $('#result-content');
    expect(screen.querySelectorAll('a[href^="http"]')).toHaveLength(0);
    expect(screen.textContent).not.toMatch(/출처|공급사|공개 표시가|\d+건|Global|globalsources|비슷한 공개가/);
  });

  it('asks the range again, and not the analysis, when a recognised value is corrected with "수정하기"', async () => {
    await openResult();

    click($('#resultEditBtn'));
    expect($('#resultClosure').hidden).toBe(false);
    expect($('#resultClosureText').hidden).toBe(true);
    expect($('#resultEditBtn').textContent).toBe('수정 완료');

    choose($('#resultOutsole'), 'spike');
    await settle(400);

    expect(rangeCalls()).toHaveLength(2);
    expect(JSON.parse(rangeCalls()[1][1].body).outsole).toBe('spike');
    expect($('#resultOutsoleText').textContent).toBe('스파이크');
    expect($('#resultRecognitionNote').textContent).toBe(resultApi.TEXTS.edited);
    expect(fetchMock.mock.calls.filter(call => isAnalysis(call[0]))).toHaveLength(1);

    click($('#resultEditBtn'));
    expect($('#resultClosure').hidden).toBe(true);
    expect($('#resultEditBtn').textContent).toBe('수정하기');
  });

  it('shows a line and no table when the range cannot be had, and the detailed quote stays possible', async () => {
    fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? answer(200, { analysis: ANALYSIS }) : answer(500, {})));
    await openResult();

    expect($('#resultCostTable').hidden).toBe(true);
    expect($('#resultCostStatus').textContent).toBe(resultApi.TEXTS.failed);
    expect($('#detailedBtn')).not.toBeNull();
  });

  it('puts every text in as text, never as markup', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      isAnalysis(url) ? answer(200, { analysis: { ...ANALYSIS, overview: '<img src=x onerror=alert(1)>', unconfirmed: ['<b>x</b>'] } }) : answer(200, RANGE_ANSWER)
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
    expect($('#result-content').classList.contains('active')).toBe(false);
    expect(g.document.body.getAttribute('data-golf-stage')).toBe('photo');
  });
});

describe('the detailed quote: the specification is asked only after the log in', () => {
  const CUSTOMER = { name: 'Kim', email: 'kim@example.com', phone: '010-1234-5678', company_name: 'Acme', customer_type: 'business_brand' };

  it('asks to log in when the visitor is not signed in, and shows no specification', async () => {
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#detailedLogin').hidden).toBe(false);
    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#specForm').hidden).toBe(true);
  });

  it('shows the specification form, filled with the recognised outsole and material, for a signed-in customer', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#specForm').hidden).toBe(false);
    expect($('#photoStage').hidden).toBe(true);
    expect($('#step2Title').textContent).toBe(resultApi.TEXTS.specTitle);
    expect($('#step2Description').textContent).toContain('2~3일');
    expect($('#nextBtn2').textContent).toBe('다음 단계');
    expect($('#material').value).toBe('microfiber');
    expect($('#outsole').value).toBe('spikeless');
    expect($('#material').getAttribute('data-ai-filled')).toBe('true');
  });

  it('uses the values the visitor corrected on the result screen, and never replaces a value typed in the form', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();
    click($('#resultEditBtn'));
    choose($('#resultOutsole'), 'hybrid');
    choose($('#resultUpper'), 'leather');
    await settle(400);

    click($('#detailedBtn'));
    await settle(50);

    expect($('#outsole').value).toBe('hybrid');
    expect($('#material').value).toBe('leather');
  });

  it('goes on to step 3 as a detailed request when the specification is complete, and not before', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();
    click($('#detailedBtn'));
    await settle(50);

    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(false);
    expect($('#step2-content').classList.contains('active')).toBe(true);

    $('#size260').checked = true;
    $('#quantity').value = '600';
    click($('#nextBtn2'));

    expect($('#step3-content').classList.contains('active')).toBe(true);
    expect($('#detailedNote').hidden).toBe(false);
    expect($('#step3-content h2').textContent).toBe('담당자 상세견적 요청 정보를 확인하세요');
  });

  it('tells the minimum order of the AI quote under the quantity of the specification (800 pairs for spikes or a dial)', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#quantityHint').textContent).toBe('AI 견적 기준 이 사양의 최소 주문 수량은 800켤레입니다.');
    expect($('#quantity').getAttribute('min')).toBe('300');
  });

  it('returns to the result, not to step 1, with the back button of the specification', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();
    click($('#detailedBtn'));
    await settle(50);

    click($('#step2Back'));

    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#step1-content').classList.contains('active')).toBe(false);
  });
});

describe('golf-shoe-result.js helpers', () => {
  it('reads the spec with "unknown" for what is empty', () => {
    expect(resultApi.readSpec({ outsole: 'spike', closure: '', upper_material: undefined })).toEqual({ outsole: 'spike', closure: 'unknown', upper_material: 'unknown' });
  });

  it('describes a region with a range, without one, and for another currency', () => {
    expect(resultApi.describeRegion(RANGE_ANSWER.overseas, 800)).toEqual({
      ok: true, unit: '31,100원 ~ 43,300원', sub: '약 $23.5 ~ $32.7', moq: '800켤레', total: '24,880,000원 ~ 34,640,000원'
    });
    expect(resultApi.describeRegion(RANGE_ANSWER.domestic, 600)).toEqual({ ok: false, message: RANGE_ANSWER.domestic.reason });
    expect(resultApi.describeRegion(undefined, 600).message).toBe(resultApi.TEXTS.unavailable);
    const krw = resultApi.describeRegion({ status: 'ok', currency: 'KRW', low: 40000, high: 52000, unit_krw: { low: 40000, high: 52000 }, total_krw: { low: 2.4e7, high: 3.12e7 } }, 600);
    expect(krw.sub).toBe('');
  });

  it('turns the answers of the server into what to show', () => {
    expect(resultApi.interpretRange(429, {})).toEqual({ kind: 'busy' });
    expect(resultApi.interpretRange(500, {})).toEqual({ kind: 'failed' });
    expect(resultApi.interpretRange(200, { overseas: {}, domestic: {} }).notice).toBe(resultApi.TEXTS.notice);
  });
});

describe('the markup of the result screen', () => {
  it('keeps every id once and has the two ways of production side by side', () => {
    const html = readRoot('shoes-estimate.html');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect($('#resultCostTable thead').textContent).toContain('해외(중국) 생산');
    expect($('#resultCostTable thead').textContent).toContain('국내 생산');
    expect(html).not.toMatch(/출처|공급사/);
  });
});
