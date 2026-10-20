/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}

function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

const RANGE_ANSWER = {
  available: true,
  currency: 'KRW',
  quantity: 500,
  unit_price: { min: 12800, max: 17300 },
  total_price: { min: 6400000, max: 8650000 },
  notice: 'guidance only, not a quote'
};

const ANALYSIS_ANSWER = {
  analysis: {
    is_sunglasses: true,
    frame_material: 'acetate',
    lens_type: 'gradient',
    confidence: 'medium',
    summary: 'Thick acetate frame.'
  },
  notice: 'Estimated from the photo.'
};

const answer = (status: number, body: unknown) => ({ status, json: async () => body });
const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-image');

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js');
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

// The fake API: the analysis answer is chosen per test, the price guidance always answers.
function route(analysis: unknown = answer(200, ANALYSIS_ANSWER)): void {
  fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? analysis : answer(200, RANGE_ANSWER)));
}

function upload(name = 'frame.png', mime = 'image/png', size = 100): any {
  const file = new g.File([new Uint8Array(size)], name, { type: mime });
  Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
  imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
  return file;
}

const withMaterial = (frame_material: string, summary = 'Thick acetate frame.') =>
  answer(200, { ...ANALYSIS_ANSWER, analysis: { ...ANALYSIS_ANSWER.analysis, frame_material, summary } });

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
});

describe('the photo of the sunglasses form', () => {
  it('sends the photo as a form and fills the two selects from the answer', async () => {
    const file = upload();
    await settle(0);

    const [url, init] = analysisCalls()[0];
    expect(url).toBe('http://localhost:4000/api/estimate-preview/analyze-image');
    expect(init.method).toBe('POST');
    expect(init.body.get('image')).toBe(file);
    expect(Array.from(init.body.keys())).toEqual(['image']);

    expect($('#frameMaterial').value).toBe('acetate');
    expect($('#lensType').value).toBe('gradient');
    const text = $('#imageAnalysisStatus').textContent;
    expect(text).toContain('Thick acetate frame.');
    expect(text).toContain('재질: 아세테이트');
    expect(text).toContain('Estimated from the photo.');
    expect($('#imageAnalysisStatus').hidden).toBe(false);
  });

  it('keeps the photo and the whole analysis for the result screen, and drops them with the photo', async () => {
    const file = upload();
    await settle(0);

    const kept = g.BridgePathPreview.getPhoto();
    expect(kept.file).toBe(file);
    expect(kept.analysis).toEqual(ANALYSIS_ANSWER.analysis);

    Object.defineProperty(imageInput, 'files', { value: [], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle(0);
    expect(g.BridgePathPreview.getPhoto()).toEqual({ file: null, analysis: null });
  });

  it('keeps nothing of a photo that could not be analysed', async () => {
    route(answer(502, { code: 'X' }));
    upload();
    await settle(0);

    expect(g.BridgePathPreview.getPhoto()).toEqual({ file: null, analysis: null });
  });

  it('asks for no price on its own: the price comes with the start of the quote', async () => {
    upload();
    await settle(0);
    type($('#quantity'), '500');
    await settle(1000);

    expect(fetchMock.mock.calls.filter(call => !isAnalysis(call[0]))).toHaveLength(0);
  });

  it('never replaces a choice the visitor made', async () => {
    choose($('#frameMaterial'), 'wood');
    upload();
    await settle(0);

    expect($('#frameMaterial').value).toBe('wood');
    expect($('#lensType').value).toBe('gradient');
    expect($('#imageAnalysisStatus').textContent).not.toContain('재질:');
  });

  it('lets a second photo replace what the first one filled, but not a later choice', async () => {
    upload('a.png');
    await settle(0);
    expect($('#frameMaterial').value).toBe('acetate');

    route(withMaterial('metal'));
    upload('b.png');
    await settle(0);
    expect($('#frameMaterial').value).toBe('metal');

    choose($('#frameMaterial'), 'plastic');
    route(withMaterial('wood'));
    upload('c.png');
    await settle(0);
    expect($('#frameMaterial').value).toBe('plastic');
  });

  it('leaves a select empty when the photo cannot tell, and says so', async () => {
    route(
      answer(200, {
        ...ANALYSIS_ANSWER,
        analysis: { ...ANALYSIS_ANSWER.analysis, frame_material: 'unknown', lens_type: 'unknown', summary: '' }
      })
    );
    upload();
    await settle(0);

    expect($('#frameMaterial').value).toBe('');
    expect($('#lensType').value).toBe('');
    expect($('#imageAnalysisStatus').textContent).toContain('직접 선택');
  });

  it('says so when the photo does not show sunglasses, and fills nothing', async () => {
    route(answer(200, { analysis: { ...ANALYSIS_ANSWER.analysis, is_sunglasses: false } }));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain('선글라스 사진으로 보이지 않아요');
    expect($('#frameMaterial').value).toBe('');
  });

  it.each([
    [503, '아직 사용할 수 없어요'],
    [429, '잠시 후'],
    [413, '5MB'],
    [502, '분석하지 못했어요']
  ])('shows a plain line for a %i answer and leaves the form usable', async (status, text) => {
    route(answer(status, { code: 'X' }));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain(text);
    expect($('#frameMaterial').value).toBe('');
    expect($('#nextBtn2').disabled).toBe(false);
  });

  it('shows the failure line after a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').textContent).toContain('분석하지 못했어요');
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
    fetchMock.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = resolve; })
    );
    route(withMaterial('metal', 'Second photo.'));

    upload('first.png');
    await settle(0);
    expect(analysisCalls()).toHaveLength(1);
    upload('second.png');
    await settle(0);
    expect(analysisCalls()).toHaveLength(2);
    releaseFirst(answer(200, ANALYSIS_ANSWER));
    await settle(0);

    expect($('#frameMaterial').value).toBe('metal');
    expect($('#imageAnalysisStatus').textContent).toContain('Second photo.');
  });

  it('shows what the server said as text, not as markup', async () => {
    route(
      answer(200, {
        analysis: { ...ANALYSIS_ANSWER.analysis, summary: '<img src=x onerror="alert(1)">' },
        notice: '<b>bold</b>'
      })
    );
    upload();
    await settle(0);

    expect($('#imageAnalysisStatus').querySelector('img, b')).toBeNull();
    expect($('#imageAnalysisStatus').textContent).toContain('<img src=x');
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
      expect($('#frameMaterial').value).toBe('acetate');
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

  it('clears the line when the photo is removed', async () => {
    upload();
    await settle(0);

    Object.defineProperty(imageInput, 'files', { value: [], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle(0);

    expect($('#imageAnalysisStatus').hidden).toBe(true);
  });
});
