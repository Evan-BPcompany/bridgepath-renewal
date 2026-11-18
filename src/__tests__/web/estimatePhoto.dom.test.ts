/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

// The photo of the sunglasses page (2026-11-18: the same photo step as the golf shoe page, golf-shoe-photo.js). The specification
// form is not in step 2 any more; what the photo shows goes to the result screen (sunglassesResult.dom.test.ts).

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);

const ANALYSIS_ANSWER = {
  analysis: {
    is_sunglasses: true,
    frame_material: 'acetate',
    lens_type: 'gradient',
    frame: 'acetate',
    lens: 'unknown',
    mirror: false,
    gradient: true,
    photochromic: false,
    confidence: 'medium',
    summary: 'Thick acetate frame.'
  },
  notice: 'Estimated from the photo.'
};

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-image');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'golf-shoe-photo.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
// estimate-common.js replaces the content of the upload box after the first choice, which removes the
// input from the document; the page keeps working with the element it already holds, so the tests do too.
let imageInput: any;

const settle = async (ms = 400): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};

const analysisCalls = (): any[] => fetchMock.mock.calls.filter(call => isAnalysis(call[0]));

function route(analysis: unknown = answer(200, ANALYSIS_ANSWER)): void {
  fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? analysis : answer(404, {})));
}

function upload(name = 'frame.png', mime = 'image/png', size = 100): any {
  const file = new g.File([new Uint8Array(size)], name, { type: mime });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
  return file;
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.fn();
  route();
  g.fetch = fetchMock;
  loaded = loadPage('sunglasses-estimate.html', SCRIPTS());
  imageInput = $('#sunglassImage');
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.BridgePathGolfShoePhoto;
});

describe('the photo of the sunglasses page', () => {
  it('sends only the photo to the sunglasses analysis, keeps the analysis and makes "AI 견적 시작" ready', async () => {
    expect($('#nextBtn2').disabled).toBe(true);
    const file = upload();
    await settle(0);

    const [url, init] = analysisCalls()[0];
    expect(url).toBe('http://localhost:4000/api/estimate-preview/analyze-image');
    expect(init.method).toBe('POST');
    expect(init.body.get('image')).toBe(file);
    expect(Array.from(init.body.keys())).toEqual(['image']);

    expect(g.BridgePathGolfShoePhoto.getPhoto()).toEqual({ file, analysis: ANALYSIS_ANSWER.analysis });
    expect($('#nextBtn2').disabled).toBe(false);
    expect($('#imageAnalysisStatus').textContent).toContain('AI 견적 시작');
  });

  it('says how far the analysis is while it takes long: the frame and lens, then "almost there"', async () => {
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    upload();
    await settle(100);

    expect($('#imageAnalysisStatus').textContent).toBe('사진을 분석하고 있습니다…');
    await settle(4000);
    expect($('#imageAnalysisStatus').textContent).toBe('프레임과 렌즈를 살펴보고 있습니다…');
    await settle(8000);
    expect($('#imageAnalysisStatus').textContent).toBe('거의 끝났습니다. 조금만 기다려 주세요…');

    finish(answer(200, ANALYSIS_ANSWER));
    await settle(0);
    expect($('#nextBtn2').disabled).toBe(false);
  });

  it('keeps nothing of a photo that could not be analysed, and drops the analysis with the photo', async () => {
    upload();
    await settle(0);
    Object.defineProperty(imageInput, 'files', { value: [], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle(0);
    expect(g.BridgePathGolfShoePhoto.getPhoto()).toEqual({ file: null, analysis: null });
    expect($('#imageAnalysisStatus').hidden).toBe(true);

    route(answer(502, { code: 'X' }));
    upload();
    await settle(0);
    expect(g.BridgePathGolfShoePhoto.getPhoto()).toEqual({ file: null, analysis: null });
    expect($('#nextBtn2').disabled).toBe(true);
  });

  it('says so when the photo does not show sunglasses', async () => {
    route(answer(200, { analysis: { ...ANALYSIS_ANSWER.analysis, is_sunglasses: false } }));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain('선글라스 사진으로 보이지 않습니다');
    expect($('#nextBtn2').disabled).toBe(true);
  });

  it.each([
    [503, '아직 사용할 수 없습니다'],
    [429, '잠시 후'],
    [413, '5MB'],
    [502, '분석하지 못했습니다']
  ])('shows a plain line for a %i answer', async (status, text) => {
    route(answer(status, { code: 'X' }));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain(text);
  });

  it('shows the failure line after a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain('분석하지 못했습니다');
  });

  it('does not send a file that cannot be analysed', async () => {
    upload('doc.pdf', 'application/pdf');
    await settle(0);
    expect($('#imageAnalysisStatus').textContent).toContain('JPG, PNG, WEBP');

    upload('big.png', 'image/png', 5 * 1024 * 1024 + 1);
    await settle(0);
    expect($('#imageAnalysisStatus').textContent).toContain('5MB');

    expect(analysisCalls()).toHaveLength(0);
  });

  it('drops the answer of a photo that was replaced meanwhile', async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }));
    const second = { ...ANALYSIS_ANSWER, analysis: { ...ANALYSIS_ANSWER.analysis, frame: 'metal' } };
    route(answer(200, second));

    upload('first.png');
    await settle(0);
    upload('second.png');
    await settle(0);
    expect(analysisCalls()).toHaveLength(2);
    releaseFirst(answer(200, ANALYSIS_ANSWER));
    await settle(0);

    expect(g.BridgePathGolfShoePhoto.getPhoto().analysis.frame).toBe('metal');
  });

  describe('a large photo', () => {
    const drawn: Array<{ width: number; height: number }> = [];
    let originals: Record<string, unknown>;

    beforeEach(() => {
      drawn.length = 0;
      originals = {
        createImageBitmap: g.createImageBitmap,
        getContext: g.HTMLCanvasElement.prototype.getContext,
        toBlob: g.HTMLCanvasElement.prototype.toBlob
      };
      g.createImageBitmap = jest.fn().mockResolvedValue({ width: 4000, height: 3000, close: jest.fn() });
      g.HTMLCanvasElement.prototype.getContext = function () {
        const canvas = this;
        return { fillStyle: '', fillRect: jest.fn(), drawImage: () => drawn.push({ width: canvas.width, height: canvas.height }) };
      };
      g.HTMLCanvasElement.prototype.toBlob = function (callback: (blob: unknown) => void, mime: string) {
        callback(new g.Blob([new Uint8Array(200000)], { type: mime }));
      };
    });

    afterEach(() => {
      g.createImageBitmap = originals.createImageBitmap;
      g.HTMLCanvasElement.prototype.getContext = originals.getContext;
      g.HTMLCanvasElement.prototype.toBlob = originals.toBlob;
    });

    it('is scaled down to 1600 px on the long edge and sent as a JPEG', async () => {
      upload('ONIR_0064.png', 'image/png', 6 * 1024 * 1024);
      await settle(0);

      expect(drawn).toEqual([{ width: 1600, height: 1200 }]);
      const sent = analysisCalls()[0][1].body.get('image');
      expect(sent.type).toBe('image/jpeg');
      expect(sent.name).toBe('ONIR_0064.jpg');
      expect(sent.size).toBe(200000);
    });

    it('leaves a photo of 1 MB or less as it is', async () => {
      const file = upload('small.png', 'image/png', 900 * 1024);
      await settle(0);

      expect(g.createImageBitmap).not.toHaveBeenCalled();
      expect(analysisCalls()[0][1].body.get('image')).toBe(file);
    });

    it('sends the original when the browser cannot decode it, and refuses it if it is over 5 MB', async () => {
      g.createImageBitmap = jest.fn().mockRejectedValue(new Error('decode failed'));

      upload('odd.png', 'image/png', 2 * 1024 * 1024);
      await settle(0);
      expect(analysisCalls()).toHaveLength(1);

      upload('odd-big.png', 'image/png', 6 * 1024 * 1024);
      await settle(0);
      expect(analysisCalls()).toHaveLength(1);
      expect($('#imageAnalysisStatus').textContent).toContain('5MB');
    });

    it('never decodes a file that is not an image', async () => {
      upload('doc.pdf', 'application/pdf', 6 * 1024 * 1024);
      await settle(0);

      expect(g.createImageBitmap).not.toHaveBeenCalled();
      expect(analysisCalls()).toHaveLength(0);
    });
  });
});
