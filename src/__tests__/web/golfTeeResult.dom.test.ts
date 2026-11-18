/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, readRoot, LoadedPage } from './domHarness';

// The golf tee quote (2026-11-18): the golf shoe flow (golf-shoe-photo.js, golf-shoe-result.js) with the material as the one recognised
// value, the range of one package of 50 tees and the minimum order of 1,000 packages.

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const resultApi = require('../../../golf-shoe-result.js');

const ANALYSIS = {
  is_golf_tee: true,
  material: 'bamboo',
  shape: 'standard',
  length: '약 70mm로 보임',
  color: '흰색',
  logo_visible: true,
  confidence: 'medium',
  summary: '로고가 인쇄된 흰색 대나무 티예요.',
  complexity: 'low',
  overview: '기본형 대나무 골프티입니다.',
  details: { body: '곧은 대나무 몸체', head: '기본 컵', finish: '흰색 도장과 로고 인쇄' },
  unconfirmed: ['정확한 길이', '도장 방식'],
  cost_factors: ['로고 인쇄'],
  recommendations: ['단색 인쇄로 단순화']
};

const RANGE_ANSWER = {
  spec: { material: 'bamboo' },
  unit: 'package',
  tees_per_package: 50,
  moq: 1000,
  overseas: { status: 'ok', currency: 'USD', low: 2, high: 2.2, unit_krw: { low: 2650, high: 2910 }, total_krw: { low: 2650000, high: 2910000 } },
  domestic: { status: 'insufficient', currency: 'KRW', reason: '국내 기준은 상세견적이 필요한 사양입니다.' },
  notice: '참고용 범위이며 확정 견적이 아닙니다.'
};

const CUSTOMER = { name: 'Kim', email: 'kim@example.com', company_name: 'Acme', customer_type: 'business_brand' };

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-golf-tee');
const isRange = (url: string): boolean => url.endsWith('/api/estimate-preview/golf-tee-range');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('golf');
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

async function openResult(): Promise<void> {
  const file = new g.File([new Uint8Array(100)], 'tees.png', { type: 'image/png' });
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
  loaded = loadPage('golf-estimate.html', SCRIPTS());
  imageInput = $('#teeImage');
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.BridgePathAuth;
  delete g.BridgePathGolfShoePhoto;
  delete g.BridgePathGolfShoeResult;
  g.document.body.removeAttribute('data-golf-stage');
});

describe('the result screen of the golf tee quote', () => {
  it('sends the photo to the golf tee analysis and shows what it found', async () => {
    await openResult();

    expect(fetchMock.mock.calls.filter(call => isAnalysis(call[0]))).toHaveLength(1);
    expect($('#result-content').classList.contains('active')).toBe(true);
    expect($('#resultMaterialText').textContent).toBe('대나무');
    expect([$('#resultShape').textContent, $('#resultLength').textContent, $('#resultColor').textContent]).toEqual(['기본형', '약 70mm로 보임', '흰색']);
    expect([$('#resultDetailBody').textContent, $('#resultDetailHead').textContent, $('#resultDetailFinish').textContent]).toEqual(['곧은 대나무 몸체', '기본 컵', '흰색 도장과 로고 인쇄']);
    expect($$('#resultUnconfirmed li').map(item => item.textContent)).toEqual(['정확한 길이', '도장 방식']);
  });

  it('asks the range of the material and shows one package, the minimum order in packages and the total', async () => {
    await openResult();

    expect(JSON.parse(rangeCalls()[0][1].body)).toEqual({ material: 'bamboo' });
    expect($('#resultOverseasUnit').textContent).toContain('2,650원 ~ 2,910원');
    expect($('#resultOverseasMoq').textContent).toBe('1,000패키지');
    expect($('#resultOverseasTotal').textContent).toBe('2,650,000원 ~ 2,910,000원');
    expect($('#resultDomesticUnit').textContent).toBe('국내 기준은 상세견적이 필요한 사양입니다.');
    expect($('#result-content').textContent).not.toMatch(/출처|공급사|\d+건|Global/);
  });

  it('asks the range again when the material is corrected', async () => {
    await openResult();

    click($('#resultEditBtn'));
    $('#resultMaterial').value = 'plastic';
    $('#resultMaterial').dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle(400);

    expect(JSON.parse(rangeCalls()[1][1].body)).toEqual({ material: 'plastic' });
    expect($('#resultRecognitionNote').textContent).toBe(resultApi.TEXTS.edited);
  });

  it('fills the material of the specification for a signed-in customer and tells the minimum order in packages', async () => {
    me.mockResolvedValue({ ok: true, status: 200, body: { customer: CUSTOMER } });
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#specForm').hidden).toBe(false);
    expect($('#step2Title').textContent).toBe(resultApi.TEXTS.specTitle);
    expect($('#material').value).toBe('bamboo');
    expect($('#quantityHint').textContent).toBe('AI 견적 기준 이 사양의 최소 주문 수량은 1,000패키지입니다.');

    $('#quantity').value = '1000';
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
    expect($('#detailedNote').hidden).toBe(false);
  });

  it('asks to log in when the visitor is not signed in', async () => {
    await openResult();

    click($('#detailedBtn'));
    await settle(50);

    expect($('#detailedLogin').hidden).toBe(false);
    expect($('#specForm').hidden).toBe(true);
  });
});

describe('the markup of the golf tee page', () => {
  it('keeps every id once and has no way to start without a photo', () => {
    const html = readRoot('golf-estimate.html');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain('id="manualBtn"');
    expect(html).not.toContain('id="marketPreview"');
  });
});
