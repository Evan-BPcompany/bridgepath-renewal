/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';
import { stripInvalidAiPreview } from '../../utils/specification';

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
function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}
function click(element: any): void {
  element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const settle = async (ms = 0): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};

const answer = (status: number, body: unknown) => ({
  status,
  headers: { get: () => null },
  json: async () => body
});

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
  details: { frame: '두께감 있는 프레임', lens: '그라데이션 틴트', decoration: '은색 핀' },
  cost_factors: ['아세테이트 가공'],
  recommendations: ['사출 프레임으로 변경하면 원가 절감']
};

const RANGE = {
  available: true,
  currency: 'KRW',
  quantity: 500,
  unit_price: { min: 8300, max: 11300 },
  total_price: { min: 4150000, max: 5650000 },
  notice: 'guidance only'
};

const CREATED = { receipt_id: 'BP20261013001', created_at: '2026-10-13T03:00:00.000Z', message: 'fixed message' };

let loaded: LoadedPage | undefined;
let fetchMock: jest.Mock;
let imageInput: any;
let estimateAnswer: any;

const isAnalysis = (url: string): boolean => url.endsWith('/api/estimate-preview/analyze-image');
const isPreview = (url: string): boolean => url.endsWith('/api/estimate-preview');
const isEstimate = (url: string): boolean => url.endsWith('/api/estimates');
const sent = (): any[] => fetchMock.mock.calls.filter(call => isEstimate(call[0]));

const SUNGLASSES_SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'estimate-result.js');
  return scripts;
};

beforeEach(() => {
  jest.useFakeTimers();
  g.scrollTo = jest.fn();
  g.URL.createObjectURL = jest.fn(() => 'blob:photo');
  g.URL.revokeObjectURL = jest.fn();
  estimateAnswer = answer(201, CREATED);
  fetchMock = jest.fn(async (url: string) => {
    if (isAnalysis(url)) {
      return answer(200, { analysis: ANALYSIS, notice: 'n' });
    }
    if (isPreview(url)) {
      return answer(200, RANGE);
    }
    return estimateAnswer;
  });
  g.fetch = fetchMock;
});

afterEach(() => {
  loaded?.dispose();
  loaded = undefined;
  delete g.fetch;
  // Each page loads its own scripts: what an earlier page defined must not be there for the next.
  delete g.BridgePathResult;
  delete g.BridgePathPreview;
  delete g.BridgePathAttachments;
  delete g.URL.createObjectURL;
  delete g.URL.revokeObjectURL;
  jest.useRealTimers();
});

function photo(name = 'frame.png', type = 'image/png'): any {
  return new g.File([new Uint8Array(100)], name, { type });
}

function fillCustomer(): void {
  check($('#customerTypeBusiness'));
  type($('#customerName'), 'Kim Minsu');
  type($('#customerCompany'), 'Bridge Co');
  type($('#customerEmail'), 'buyer@example.com');
  check($('#privacyConsent'));
}

async function openSunglassesAtStep3(withPhoto = true): Promise<any> {
  loaded = loadPage('sunglasses-estimate.html', SUNGLASSES_SCRIPTS());
  imageInput = $('#sunglassImage');
  click($('.category-card[data-category="sunglasses"]'));
  click($('#nextBtn1'));
  const file = photo();
  if (withPhoto) {
    Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle();
  } else {
    choose($('#frameMaterial'), 'metal');
    choose($('#lensType'), 'normal');
  }
  type($('#quantity'), '500');
  click($('#nextBtn2'));
  await settle();
  click($('#resultRequestBtn'));
  expect($('#step3-content').classList.contains('active')).toBe(true);
  return file;
}

describe('a sunglasses request with the photo that was analysed', () => {
  it('attaches the photo as soon as it is ready, marked, before any request', async () => {
    loaded = loadPage('sunglasses-estimate.html', SUNGLASSES_SCRIPTS());
    imageInput = $('#sunglassImage');
    const file = photo();

    Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle();

    expect($('#attachments .attachments-name').textContent).toBe('frame.png');
    expect($('#attachments .attachments-tag').textContent).toBe('AI 분석에 쓴 사진');
    expect(g.BridgePathAttachments.instance.getFiles()).toEqual([file]);
    expect(sent()).toHaveLength(0);
  });

  it('keeps the photo attached when the analysis fails: the customer chose it', async () => {
    fetchMock.mockImplementation(async (url: string) => (isAnalysis(url) ? answer(503, {}) : answer(200, RANGE)));
    loaded = loadPage('sunglasses-estimate.html', SUNGLASSES_SCRIPTS());
    imageInput = $('#sunglassImage');

    Object.defineProperty(imageInput, 'files', { value: [photo()], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle();

    expect($('#imageAnalysisStatus').textContent).toContain('아직 사용할 수 없어요');
    expect($('#attachments .attachments-name').textContent).toBe('frame.png');
  });

  it('drops the photo from the attachments when the customer chooses no photo any more', async () => {
    loaded = loadPage('sunglasses-estimate.html', SUNGLASSES_SCRIPTS());
    imageInput = $('#sunglassImage');
    Object.defineProperty(imageInput, 'files', { value: [photo()], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle();

    Object.defineProperty(imageInput, 'files', { value: [], configurable: true });
    imageInput.dispatchEvent(new g.Event('change', { bubbles: true }));
    await settle();

    expect($$('#attachments .attachments-name')).toHaveLength(0);
  });

  it('sends one multipart form with the photo and the record of what the screen showed', async () => {
    const file = await openSunglassesAtStep3();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    expect(sent()).toHaveLength(1);
    const [url, init] = sent()[0];
    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.body).toBeInstanceOf(g.FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    const form: any = init.body;
    expect(form.get('category')).toBe('eyewear');
    expect(form.get('privacy_consent')).toBe('true');
    expect(form.getAll('files')).toHaveLength(1);
    expect(form.getAll('files')[0].name).toBe('frame.png');
    // The form holds its own copy of the file: same name, size and type.
    expect(form.getAll('files')[0].size).toBe(file.size);
    expect(form.getAll('files')[0].type).toBe('image/png');

    const spec = JSON.parse(form.get('specification_json'));
    expect(spec).toMatchObject({ material: 'acetate', lens_type: 'gradient', quantity: 500 });
    expect(spec.ai_preview).toEqual({
      source: 'customer_screen',
      analysis: {
        frame_material: 'acetate',
        lens_type: 'gradient',
        confidence: 'medium',
        complexity: 'medium',
        frame_shape: '스퀘어',
        frame_color: '블랙',
        overview: '두꺼운 아세테이트 프레임의 클래식 선글라스입니다.',
        details: { frame: '두께감 있는 프레임', lens: '그라데이션 틴트', decoration: '은색 핀' },
        cost_factors: ['아세테이트 가공'],
        recommendations: ['사출 프레임으로 변경하면 원가 절감']
      },
      price: {
        currency: 'KRW',
        quantity: 500,
        unit_price: { min: 8300, max: 11300 },
        total_price: { min: 4150000, max: 5650000 }
      }
    });
  });

  // The record is written by the browser and checked by the API: the two must agree.
  it('writes a record that the API accepts as it is', async () => {
    await openSunglassesAtStep3();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    const spec = JSON.parse(sent()[0][1].body.get('specification_json'));
    expect(stripInvalidAiPreview(spec).dropped).toBe(false);
  });

  it('cuts a long analysis to the limits of the API instead of losing the whole record', async () => {
    const long = {
      ...ANALYSIS,
      overview: 'o'.repeat(3000),
      frame_shape: 's'.repeat(500),
      details: { frame: 'f'.repeat(900), lens: 'l'.repeat(900), decoration: 'd'.repeat(900) },
      cost_factors: ['1', '2', '3', '4', '5', '6'].map(n => n.repeat(400)),
      recommendations: ['r1', 'r2', 'r3', 'r4', 'r5']
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (isAnalysis(url)) {
        return answer(200, { analysis: long, notice: 'n' });
      }
      return isPreview(url) ? answer(200, RANGE) : estimateAnswer;
    });
    await openSunglassesAtStep3();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    const spec = JSON.parse(sent()[0][1].body.get('specification_json'));
    expect(stripInvalidAiPreview(spec).dropped).toBe(false);
    expect(spec.ai_preview.analysis.overview).toHaveLength(1000);
    expect(spec.ai_preview.analysis.cost_factors).toHaveLength(4);
    expect(spec.ai_preview.analysis.cost_factors[0]).toHaveLength(200);
  });

  it('sends plain JSON when the customer took the photo out, still with the record', async () => {
    await openSunglassesAtStep3();
    click($('#resultEditBtn'));
    click($('#attachments .attachments-remove'));
    click($('#nextBtn2'));
    await settle();
    click($('#resultRequestBtn'));
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    const [, init] = sent()[0];
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body);
    expect(body.files).toBeUndefined();
    expect(body.specification_json.ai_preview.source).toBe('customer_screen');
  });

  it('sends no record when there was no photo, but the price the screen showed is in it', async () => {
    await openSunglassesAtStep3(false);
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    const spec = JSON.parse(sent()[0][1].body).specification_json;
    expect(spec.ai_preview.analysis).toBeUndefined();
    expect(spec.ai_preview.price.unit_price).toEqual({ min: 8300, max: 11300 });
  });

  it('sends no record when the price could not be had and there was no photo', async () => {
    fetchMock.mockImplementation(async (url: string) => (isPreview(url) ? answer(500, {}) : estimateAnswer));
    await openSunglassesAtStep3(false);
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    expect(JSON.parse(sent()[0][1].body).specification_json.ai_preview).toBeUndefined();
  });

  it('empties the attachments after a request that was accepted, and shows the receipt number', async () => {
    await openSunglassesAtStep3();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    expect($('#receiptId').textContent).toBe('BP20261013001');
    expect(g.BridgePathAttachments.instance.getFiles()).toEqual([]);
  });

  it('says nothing was saved when the files could not be stored, and lets the customer send again', async () => {
    await openSunglassesAtStep3();
    fillCustomer();
    estimateAnswer = answer(500, { error: 'File upload failed', code: 'FILE_UPLOAD_FAILED' });

    click($('#submitBtn'));
    await settle();

    expect($('#submitError').hidden).toBe(false);
    expect($('#submitError').textContent).toContain('접수되지 않았어요');
    expect($('#receiptId').textContent).toBe('');
    expect($('#submitBtn').disabled).toBe(false);
    expect(g.BridgePathAttachments.instance.getFiles()).toHaveLength(1);

    estimateAnswer = answer(201, CREATED);
    click($('#submitBtn'));
    await settle();

    expect(sent()).toHaveLength(2);
    expect($('#receiptId').textContent).toBe('BP20261013001');
  });

  it('shows what the API refused about a file, by name', async () => {
    await openSunglassesAtStep3();
    fillCustomer();
    estimateAnswer = answer(400, {
      error: 'File validation failed',
      details: [{ filename: 'frame.png', errors: ['File magic bytes do not match MIME type'] }]
    });

    click($('#submitBtn'));
    await settle();

    expect($('#receiptId').textContent).toBe('');
    expect($('#submitBtn').disabled).toBe(false);
  });
});

describe('a request of the other pages with files', () => {
  function openShoes(): void {
    loaded = loadPage('shoes-estimate.html', PAGE_SCRIPTS('shoes'));
    click($('.category-card[data-category="sneakers"]'));
    click($('#nextBtn1'));
    choose($('#material'), 'leather');
    check($('#size250'));
    type($('#quantity'), '600');
    click($('#nextBtn2'));
  }

  it('has the shared attachments instead of the old upload box', () => {
    loaded = loadPage('shoes-estimate.html', PAGE_SCRIPTS('shoes'));

    expect($('#attachments .attachments-add')).not.toBeNull();
    expect($('#imageUploadBox')).toBeNull();
    expect($('#shoeImage')).toBeNull();
  });

  it('sends the attached files with the request, and no record of an AI screen', async () => {
    openShoes();
    const logo = photo('logo.png');
    const pdf = new g.File([new Uint8Array(10)], 'spec.pdf', { type: 'application/pdf' });
    g.BridgePathAttachments.instance.addFiles([logo, pdf]);
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    const form: any = sent()[0][1].body;
    expect(form).toBeInstanceOf(g.FormData);
    expect(form.getAll('files').map((f: any) => f.name)).toEqual(['logo.png', 'spec.pdf']);
    expect(JSON.parse(form.get('specification_json')).ai_preview).toBeUndefined();
  });

  it('sends plain JSON without attachments', async () => {
    openShoes();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    expect(typeof sent()[0][1].body).toBe('string');
  });
});

describe('the other-products inquiry with files', () => {
  it('sends the attached files with the request', async () => {
    loaded = loadPage('other-inquiry.html', [
      'config.js', 'estimate-api.js', 'estimate-customer-step.js', 'estimate-attachments.js', 'estimate-submit.js', 'other-inquiry.js'
    ]);
    type($('#productDescription'), 'Custom wooden tee');
    type($('#quantity'), '200');
    g.BridgePathAttachments.instance.addFiles([photo('sketch.png')]);
    fillCustomer();

    $('#inquiryForm').dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const form: any = sent()[0][1].body;
    expect(form).toBeInstanceOf(g.FormData);
    expect(form.get('category')).toBe('other');
    expect(form.getAll('files').map((f: any) => f.name)).toEqual(['sketch.png']);
  });
});

describe('the receipt after an accepted request (PRD FR-4.5)', () => {
  const rows = (): Array<[string, string]> => {
    const terms = $$('#receiptSummaryList dt').map(element => element.textContent);
    const values = $$('#receiptSummaryList dd').map(element => element.textContent);
    return terms.map((term, index) => [term, values[index]]);
  };
  const row = (label: string): string | undefined => rows().find(entry => entry[0] === label)?.[1];

  it('lists what was sent for a sunglasses request: product, contact, file and the range that was shown', async () => {
    await openSunglassesAtStep3();
    fillCustomer();

    click($('#submitBtn'));
    await settle();

    expect($('#receiptSummary').hidden).toBe(false);
    expect(row('제품 종류')).toBe('선글라스');
    expect(row('프레임 재질')).toBe('아세테이트');
    expect(row('렌즈 타입')).toBe('그래디언트 렌즈');
    expect(row('수량')).toBe('500개');
    expect(row('고객 유형')).toBe('사업자·브랜드 운영 중');
    expect(row('이름')).toBe('Kim Minsu');
    expect(row('회사·브랜드')).toBe('Bridge Co');
    expect(row('이메일')).toBe('buyer@example.com');
    expect(row('첨부 파일')).toBe('frame.png');
    expect(row('화면에 보인 예상 범위 (참고)')).toBe(
      '개당 약 8,300원 ~ 11,300원, 총 약 4,150,000원 ~ 5,650,000원 · 확정 견적이 아니에요'
    );
    // What was not filled in is not listed.
    expect(row('전화')).toBeUndefined();
    expect(row('프레임 색상')).toBeUndefined();
  });

  it('has the receipt number and a button that copies it', async () => {
    await openSunglassesAtStep3();
    fillCustomer();
    click($('#submitBtn'));
    await settle();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(g.navigator, 'clipboard', { value: { writeText }, configurable: true });

    click($('#copyReceipt'));
    await settle();

    expect(writeText).toHaveBeenCalledWith('BP20261013001');
    expect($('#copyReceiptNote').textContent).toBe('복사했어요.');
  });

  it('asks the customer to copy by hand when the browser cannot, or refuses', async () => {
    await openSunglassesAtStep3();
    fillCustomer();
    click($('#submitBtn'));
    await settle();

    Object.defineProperty(g.navigator, 'clipboard', { value: undefined, configurable: true });
    click($('#copyReceipt'));
    expect($('#copyReceiptNote').textContent).toBe('직접 선택해서 복사해 주세요.');

    Object.defineProperty(g.navigator, 'clipboard', { value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    click($('#copyReceipt'));
    await settle();
    expect($('#copyReceiptNote').textContent).toContain('복사하지 못했어요');
  });

  it('shows what the customer wrote as text, never as markup', async () => {
    loaded = loadPage('shoes-estimate.html', PAGE_SCRIPTS('shoes'));
    click($('.category-card[data-category="sneakers"]'));
    click($('#nextBtn1'));
    choose($('#material'), 'leather');
    check($('#size250'));
    type($('#quantity'), '600');
    type($('#additionalInfo'), '<img src=x onerror=alert(1)>');
    click($('#nextBtn2'));
    check($('#customerTypeBusiness'));
    type($('#customerName'), '<b>Kim</b>');
    type($('#customerCompany'), 'Bridge Co');
    type($('#customerEmail'), 'buyer@example.com');
    check($('#privacyConsent'));

    click($('#submitBtn'));
    await settle();

    expect(row('추가 요청사항')).toBe('<img src=x onerror=alert(1)>');
    expect(row('이름')).toBe('<b>Kim</b>');
    expect($('#receiptSummary img')).toBeNull();
    expect($('#receiptSummary b')).toBeNull();
  });

  it('lists the product of the shoes page, with the sizes and the kind', async () => {
    loaded = loadPage('shoes-estimate.html', PAGE_SCRIPTS('shoes'));
    click($('.category-card[data-category="sneakers"]'));
    click($('#nextBtn1'));
    choose($('#material'), 'leather');
    check($('#size250'));
    check($('#size270'));
    type($('#quantity'), '1200');
    click($('#nextBtn2'));
    check($('#customerTypeBusiness'));
    type($('#customerName'), 'Kim');
    type($('#customerCompany'), 'Bridge Co');
    type($('#customerPhone'), '010-1234-5678');
    check($('#privacyConsent'));

    click($('#submitBtn'));
    await settle();

    expect(row('제품 종류')).toBe('운동화');
    expect(row('주요 재질')).toBe('가죽');
    expect(row('사이즈')).toBe('250, 270');
    expect(row('수량')).toBe('1,200켤레');
    expect(row('전화')).toBe('010-1234-5678');
    expect(row('이메일')).toBeUndefined();
  });

  it('lists the other-products inquiry, with a long description cut', async () => {
    loaded = loadPage('other-inquiry.html', [
      'config.js', 'estimate-api.js', 'estimate-customer-step.js', 'estimate-attachments.js', 'estimate-submit.js', 'other-inquiry.js'
    ]);
    type($('#productDescription'), 'x'.repeat(300));
    type($('#quantity'), '200');
    fillCustomer();

    $('#inquiryForm').dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(row('제품 설명')).toBe('x'.repeat(100) + '…');
    expect(row('수량')).toBe('200개');
    expect(row('제품 종류')).toBeUndefined();
  });

  it('shows no summary box when nothing could be listed', async () => {
    loaded = loadPage('other-inquiry.html', ['config.js', 'estimate-api.js', 'estimate-customer-step.js', 'estimate-submit.js', 'other-inquiry.js']);

    expect($('#receiptSummary').hidden).toBe(true);
  });
});
