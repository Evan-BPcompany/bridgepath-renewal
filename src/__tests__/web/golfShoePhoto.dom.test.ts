/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, readRoot, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const photoApi = require('../../../golf-shoe-photo.js');

const ANALYSIS = {
  is_golf_shoe: true,
  style: 'sneaker',
  closure: 'dial',
  outsole: 'spikeless',
  upper_material: 'microfiber',
  confidence: 'medium',
  summary: '다이얼로 조이는 스파이크리스 골프화예요.',
  complexity: 'high'
};
const ANALYSIS_ANSWER = { analysis: ANALYSIS, notice: '사진으로 추정한 결과예요.' };

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-golf-shoe');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('shoes');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'golf-shoe-photo.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
let imageInput: any;

const settle = async (ms = 400): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};
const analysisCalls = (): any[] => fetchMock.mock.calls.filter(call => isAnalysis(call[0]));

function upload(name = 'shoe.png', mime = 'image/png', size = 100): any {
  const file = new g.File([new Uint8Array(size)], name, { type: mime });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
  return file;
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.fn().mockResolvedValue(answer(200, ANALYSIS_ANSWER));
  g.fetch = fetchMock;
  g.window.scrollTo = () => undefined;
  loaded = loadPage('shoes-estimate.html', SCRIPTS());
  imageInput = $('#shoeImage');
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
});

describe('the photo of the golf shoe page', () => {
  it('waits for a photo: "AI 견적 시작" is not ready before one was analysed', () => {
    expect($('#nextBtn2').disabled).toBe(true);
    expect($('#nextBtn2').textContent).toBe('AI 견적 시작');
  });

  it('sends the photo as a form, keeps the analysis, and makes "AI 견적 시작" ready', async () => {
    const file = upload();
    await settle(50);

    const [url, init] = analysisCalls()[0];
    expect(url).toBe('http://localhost:4000/api/estimate-preview/analyze-golf-shoe');
    expect(init.method).toBe('POST');
    expect(init.body.get('image')).toBe(file);
    expect(Array.from(init.body.keys())).toEqual(['image']);

    expect($('#nextBtn2').disabled).toBe(false);
    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.done);
    expect($('#imageAnalysisStatus').hidden).toBe(false);
    expect(g.BridgePathGolfShoePhoto.getPhoto().file).toBe(file);
    expect(g.BridgePathGolfShoePhoto.getPhoto().analysis).toEqual(ANALYSIS);
  });

  it('asks nothing about the specification: no price, no range, no selects are touched', async () => {
    upload();
    await settle(50);

    expect(fetchMock.mock.calls.every(call => isAnalysis(call[0]))).toBe(true);
    expect($('#material').value).toBe('');
    expect($('#outsole').value).toBe('');
  });

  it('says so and keeps the button off when the photo is not a golf shoe', async () => {
    fetchMock.mockResolvedValue(answer(200, { analysis: { ...ANALYSIS, is_golf_shoe: false }, notice: 'x' }));
    upload();
    await settle(50);

    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.not_golf_shoe);
    expect($('#imageAnalysisStatus').getAttribute('data-state')).toBe('error');
    expect($('#nextBtn2').disabled).toBe(true);
  });

  it('says what went wrong in words the visitor can use, for each kind of failure', async () => {
    const cases: Array<[unknown, string]> = [
      [answer(429, {}), 'busy'],
      [answer(503, {}), 'unavailable'],
      [answer(413, {}), 'too_large'],
      [answer(502, {}), 'failed'],
      [answer(200, { analysis: { nope: true } }), 'failed']
    ];
    for (const [response, key] of cases) {
      fetchMock.mockResolvedValue(response);
      upload();
      await settle(50);
      expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES[key]);
      expect($('#nextBtn2').disabled).toBe(true);
    }
  });

  it('does not send a file that is not a photo', async () => {
    upload('plan.pdf', 'application/pdf');
    await settle(50);

    expect(analysisCalls()).toHaveLength(0);
    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.type);
  });

  it('says how far the analysis is while it takes long: the same job, then "almost there"', async () => {
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    upload();
    await settle(100);

    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.analyzing);
    await settle(4000);
    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.analyzingMore);
    await settle(8000);
    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.analyzingLong);

    finish(answer(200, ANALYSIS_ANSWER));
    await settle(50);
    expect($('#imageAnalysisStatus').textContent).toBe(photoApi.MESSAGES.done);
  });

  it('drops the analysis and switches the button off when the photo is taken away', async () => {
    upload();
    await settle(50);

    Object.defineProperty(imageInput, 'files', { value: [], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle(50);

    expect($('#nextBtn2').disabled).toBe(true);
    expect(g.BridgePathGolfShoePhoto.getPhoto().analysis).toBeNull();
    expect($('#imageAnalysisStatus').hidden).toBe(true);
  });

  it('drops the answer of an old photo when a newer one was chosen meanwhile', async () => {
    let first: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue(answer(200, { analysis: { ...ANALYSIS, closure: 'lace' } }));
    upload('a.png');
    await settle(50);
    upload('b.png');
    await settle(50);
    first(answer(200, ANALYSIS_ANSWER));
    await settle(50);

    expect(g.BridgePathGolfShoePhoto.getPhoto().analysis.closure).toBe('lace');
  });
});

describe('golf-shoe-photo.js helpers', () => {
  it('turns the answers of the server into what to show', () => {
    expect(photoApi.interpretAnalysis(429, {})).toEqual({ kind: 'busy' });
    expect(photoApi.interpretAnalysis(503, {})).toEqual({ kind: 'unavailable' });
    expect(photoApi.interpretAnalysis(200, { analysis: { ...ANALYSIS, is_golf_shoe: false } })).toEqual({ kind: 'not_golf_shoe' });
    expect(photoApi.interpretAnalysis(200, { analysis: ANALYSIS })).toEqual({ kind: 'analysis', analysis: ANALYSIS });
    expect(photoApi.interpretAnalysis(200, {})).toEqual({ kind: 'failed' });
  });
});

describe('the markup of the golf shoe page', () => {
  it('has the photo box once, and the specification form hidden in step 2', () => {
    const html = readRoot('shoes-estimate.html');

    for (const id of ['imageUploadBox', 'shoeImage', 'imageAnalysisStatus', 'photoStage', 'specForm', 'nextBtn2']) {
      expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
    }
    expect($('#specForm').hidden).toBe(true);
    expect(html).not.toContain('사진 AI 분석은 선글라스에서만 지원합니다');
  });
});
