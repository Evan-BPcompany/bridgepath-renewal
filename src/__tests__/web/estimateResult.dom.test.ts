/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}

function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

function click(element: any): void {
  element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const RANGE_ANSWER = {
  available: true,
  currency: 'KRW',
  quantity: 500,
  unit_price: { min: 12800, max: 17300 },
  total_price: { min: 6400000, max: 8650000 },
  notice: 'guidance only, not a quote'
};

const ANALYSIS = {
  is_sunglasses: true,
  frame_material: 'acetate',
  lens_type: 'gradient',
  confidence: 'medium',
  summary: 'Thick acetate frame.',
  frame_shape: '스퀘어',
  frame_color: '블랙',
  complexity: 'medium',
  overview: '두꺼운 아세테이트 프레임의 클래식 선글라스입니다.',
  details: { frame: '두께감 있는 프레임', lens: '그라데이션 틴트', decoration: '힌지의 은색 핀' },
  cost_factors: ['아세테이트 가공', '렌즈 코팅'],
  recommendations: ['사출 프레임으로 변경하면 원가 절감']
};

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-image');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'estimate-result.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
let imageInput: any;
let priceAnswer: unknown;
let analysisAnswer: unknown;

const settle = async (ms = 0): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};

const priceCalls = (): any[] => fetchMock.mock.calls.filter(call => !isAnalysis(call[0]));

function route(): void {
  fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? analysisAnswer : priceAnswer));
}

function fillForm(material = 'plastic', lens = 'normal', quantity = '500'): void {
  choose($('#frameMaterial'), material);
  choose($('#lensType'), lens);
  type($('#quantity'), quantity);
}

function upload(): void {
  const file = new g.File([new Uint8Array(100)], 'frame.png', { type: 'image/png' });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
}

async function start(): Promise<void> {
  click($('#nextBtn2'));
  await settle();
}

const isShown = (selector: string): boolean => !$(selector).hidden;

beforeEach(() => {
  jest.useFakeTimers();
  priceAnswer = answer(200, RANGE_ANSWER);
  analysisAnswer = answer(200, { analysis: ANALYSIS, notice: 'Estimated from the photo.' });
  fetchMock = jest.fn();
  route();
  g.fetch = fetchMock;
  g.URL.createObjectURL = jest.fn(() => 'blob:photo');
  g.URL.revokeObjectURL = jest.fn();
  loaded = loadPage('sunglasses-estimate.html', SCRIPTS());
  imageInput = $('#sunglassImage');
  $('.category-card[data-category="sunglasses"]').click();
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.URL.createObjectURL;
  delete g.URL.revokeObjectURL;
});

describe('the start of the AI quote', () => {
  it('has a start button instead of the plain next button', () => {
    expect($('#nextBtn2').textContent).toBe('AI 견적 시작');
  });

  it('stays on step 2 and asks nothing while the input is not valid', async () => {
    choose($('#lensType'), 'normal');
    type($('#quantity'), '500');
    await start();

    expect($('#step2-content').classList.contains('active')).toBe(false);
    // The material is missing: the flow sends the visitor to the field, not to the result.
    expect($('#result-content').classList.contains('active')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the result screen, and not the customer step, when the input is valid', async () => {
    $('#step2-content').classList.add('active');
    $('#step1-content').classList.remove('active');
    fillForm();
    await start();

    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#step2-content').classList.contains('active')).toBe(false);
    expect($('#step3-content').classList.contains('active')).toBe(false);
  });
});

describe('the result screen without a photo', () => {
  beforeEach(async () => {
    fillForm('metal', 'polarized', '1000');
    await start();
  });

  it('shows the recognised values from the form and no analysis texts', () => {
    expect($('#resultMaterial').textContent).toBe('금속 (메탈)');
    expect($('#resultLens').textContent).toBe('편광 렌즈');
    expect($('#resultQuantity').textContent).toBe('1,000개');
    expect($('#resultRecognitionNote').textContent).toContain('입력하신 값으로 계산했어요');
    ['#resultPhotoBox', '#resultOverviewBox', '#resultDetailsBox', '#resultFactorsBox', '#resultRecommendBox', '#resultShapeRow', '#resultColorRow'].forEach(selector =>
      expect(isShown(selector)).toBe(false)
    );
  });

  it('asks for the price with the four values only and shows the range with the notice', () => {
    expect(priceCalls()).toHaveLength(1);
    const [url, init] = priceCalls()[0];
    expect(url).toBe('http://localhost:4000/api/estimate-preview');
    expect(JSON.parse(init.body)).toEqual({
      category: 'sunglasses',
      material: 'metal',
      lens_type: 'polarized',
      quantity: 1000
    });

    expect(isShown('#resultCostTable')).toBe(true);
    expect($('#resultUnit').textContent).toBe('12,800원 ~ 17,300원');
    expect($('#resultTotal').textContent).toBe('6,400,000원 ~ 8,650,000원');
    expect($('#resultNotice').textContent).toBe('guidance only, not a quote');
    expect($('#resultCostStatus').textContent).toBe('');
  });
});

describe('the result screen with a photo', () => {
  beforeEach(async () => {
    upload();
    await settle();
    type($('#quantity'), '500');
    await start();
  });

  it('shows the photo and every analysis text', () => {
    expect(isShown('#resultPhotoBox')).toBe(true);
    expect($('#resultPhoto').src).toContain('blob:photo');
    expect($('#resultOverview').textContent).toContain('클래식 선글라스');
    expect($('#resultComplexity').textContent).toBe('복잡도 · 중간');
    expect($('#resultShape').textContent).toBe('스퀘어');
    expect($('#resultColor').textContent).toBe('블랙');
    expect($('#resultDetailFrame').textContent).toBe('두께감 있는 프레임');
    expect($('#resultDetailLens').textContent).toBe('그라데이션 틴트');
    expect($('#resultDetailDecoration').textContent).toBe('힌지의 은색 핀');
    expect($$('#resultFactors li').map(item => item.textContent)).toEqual(['아세테이트 가공', '렌즈 코팅']);
    expect($$('#resultRecommendations li').map(item => item.textContent)).toEqual(['사출 프레임으로 변경하면 원가 절감']);
    expect($('#resultMaterial').textContent).toBe('아세테이트');
    expect($('#resultRecognitionNote').textContent).toContain('AI가 업로드한 사진을 분석한 결과');
  });

  it('says so when the visitor chose other values than the photo showed', async () => {
    click($('#resultEditBtn'));
    choose($('#frameMaterial'), 'wood');
    await start();

    expect($('#resultMaterial').textContent).toBe('우드');
    expect($('#resultRecognitionNote').textContent).toContain('직접 고르신 값');
  });

  it('puts every text in as text, not as markup', async () => {
    analysisAnswer = answer(200, {
      analysis: {
        ...ANALYSIS,
        overview: '<img src=x onerror="alert(1)">',
        cost_factors: ['<b>bold</b>'],
        details: { frame: '<i>x</i>', lens: 'y', decoration: 'z' }
      },
      notice: ''
    });
    upload();
    await settle();
    click($('#resultEditBtn'));
    await start();

    const screen = $('#result-content');
    expect(screen.querySelectorAll('img').length).toBe(1);
    expect(screen.querySelector('b, i')).toBeNull();
    expect($('#resultOverview').textContent).toBe('<img src=x onerror="alert(1)">');
    expect($('#resultFactors li').textContent).toBe('<b>bold</b>');
  });
});

describe('when the price cannot be shown', () => {
  it.each([
    [answer(200, { available: false, reason: 'NO_BASE_PRICE', notice: 'not a quote' }), '담당자가 확인'],
    [answer(429, { code: 'RATE_LIMITED' }), '잠시 후'],
    [answer(500, { error: 'x' }), '불러오지 못했어요'],
    [answer(200, { available: true, unit_price: 'free' }), '불러오지 못했어요']
  ])('shows a plain line instead of a table', async (response, text) => {
    priceAnswer = response;
    fillForm();
    await start();

    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#resultCostStatus').textContent).toContain(text);
    expect(isShown('#resultCostTable')).toBe(false);
    // The rest of the screen and the way on stay usable.
    expect($('#resultMaterial').textContent).toBe('플라스틱');
    expect($('#resultRequestBtn').disabled).toBe(false);
  });

  it('shows the failure line after a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    fillForm();
    await start();

    expect($('#resultCostStatus').textContent).toContain('불러오지 못했어요');
  });
});

describe('the way out of the result screen', () => {
  beforeEach(async () => {
    fillForm();
    await start();
  });

  it('goes back to step 2 with the form as it was, and asks again with the changed values', async () => {
    click($('#resultEditBtn'));

    expect($('#result-content').classList.contains('active')).toBe(false);
    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#frameMaterial').value).toBe('plastic');
    expect($('#quantity').value).toBe('500');

    type($('#quantity'), '2000');
    await start();

    expect(priceCalls()).toHaveLength(2);
    expect(JSON.parse(priceCalls()[1][1].body).quantity).toBe(2000);
    expect($('#resultQuantity').textContent).toBe('2,000개');
  });

  it('goes on to the customer step, where the request is sent', () => {
    click($('#resultRequestBtn'));

    expect($('#result-content').classList.contains('active')).toBe(false);
    expect($('#step3-content').classList.contains('active')).toBe(true);
  });

  it('drops the price of a screen that was left before the answer came', async () => {
    let releaseOld: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
    click($('#resultEditBtn'));
    await start();
    expect(priceCalls()).toHaveLength(2);

    click($('#resultEditBtn'));
    priceAnswer = answer(200, { ...RANGE_ANSWER, unit_price: { min: 1, max: 2 }, total_price: { min: 3, max: 4 } });
    route();
    await start();
    releaseOld(answer(200, RANGE_ANSWER));
    await settle();

    expect($('#resultUnit').textContent).toBe('1원 ~ 2원');
  });
});

describe('the helpers of the price request', () => {
  const preview = (): any => g.BridgePathPreview;

  it.each([
    ['500', 500],
    [' 12 ', 12],
    ['1000000', 1000000],
    ['1000001', null],
    ['0', null],
    ['-5', null],
    ['10.5', null],
    ['1e3', null],
    ['', null],
    [undefined, null]
  ])('reads the quantity %p as %p', (raw, expected) => {
    expect(preview().parseQuantity(raw)).toBe(expected);
  });

  it('builds the request without a double slash after the API address', () => {
    const request = preview().buildRequest('http://api.example.com/', {
      category: 'sunglasses', material: 'metal', lens_type: 'mirror', quantity: 10
    });
    expect(request.url).toBe('http://api.example.com/api/estimate-preview');
  });

  it('answers with a result and never throws, whatever the network does', async () => {
    const input = { category: 'sunglasses', material: 'metal', lens_type: 'mirror', quantity: 10 };

    await expect(
      preview().requestPreview({ apiBase: 'http://x', input, fetch: () => Promise.reject(new Error('down')) })
    ).resolves.toEqual({ kind: 'failed' });
    await expect(
      preview().requestPreview({ apiBase: 'http://x', input, fetch: async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) })
    ).resolves.toEqual({ kind: 'failed' });
  });
});
