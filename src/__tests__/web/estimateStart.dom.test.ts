/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, readRoot, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

function click(element: any): void {
  element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function key(element: any, name: string): any {
  const event = new g.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

// Every estimate page starts with a photo only (the golf shoe 2026-11-17, the sunglasses and the golf tee 2026-11-18): the way without a
// photo is gone, and each page has its tests below.

describe('what the two ways say and hide', () => {
  it('says on every page what the photo analysis reads, and gives every page its photo box', () => {
    expect(readRoot('sunglasses-estimate.html')).toContain('AI가 프레임과 렌즈를 추정하고 프레임·렌즈·기타 비용으로 나눈 예상 제조원가');
    expect(readRoot('golf-estimate.html')).toContain('AI가 골프티의 재질과 형태를 추정');
    expect(readRoot('shoes-estimate.html')).toContain('AI가 조임 방식·아웃솔·어퍼 재질을 추정');
    for (const page of ['sunglasses', 'shoes', 'golf']) {
      const html = readRoot(`${page}-estimate.html`);
      expect(html).toContain('id="imageUploadBox"');
      expect(html).not.toContain('사진 AI 분석은 선글라스에서만 지원합니다');
    }
  });

  it('says what needs no account and when one is needed', () => {
    // The sunglasses page works like the golf shoe page (2026-11-18): the AI quote needs no account, the detailed quote needs one.
    expect(readRoot('sunglasses-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b>[^<]*결과[^<]*볼 수 있습니다\. <b>담당자 상세견적<\/b>[^<]*로그인이 필요합니다\.<\/p>/);
    expect(readRoot('golf-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b>[^<]*결과[^<]*볼 수 있습니다\. <b>담당자 상세견적<\/b>[^<]*로그인이 필요합니다\.<\/p>/);
    // The golf shoe page (2026-11-17): the AI quote needs no account, the detailed quote (with the specification) needs one.
    const shoes = readRoot('shoes-estimate.html');
    expect(shoes).toMatch(/<p class="scope-note"><b>로그인 없이<\/b>[^<]*결과[^<]*볼 수 있습니다\. <b>담당자 상세견적<\/b>[^<]*로그인이 필요합니다\.<\/p>/);
    expect(shoes).not.toContain('아직 예상 가격 범위를 바로 안내하지 못합니다');
  });

  it('offers the kinds of the golf sourcing direction only (2026-11-11)', () => {
    const cards = (page: string): string[][] =>
      [...readRoot(`${page}-estimate.html`).matchAll(/<div class="category-card" data-category="([^"]+)">\s*<p>([^<]+)<\/p>/g)].map(match => [match[1], match[2]]);

    expect(cards('sunglasses')).toEqual([['sports', '골프·스포츠 선글라스'], ['sunglasses', '일반 선글라스']]);
    // Stored as the shoe type "other" until golf shoe types and their prices exist.
    expect(cards('shoes')).toEqual([['other', '골프화']]);
    expect(readRoot('shoes-estimate.html')).not.toMatch(/여성구두|남성구두|부츠|샌들/);
    expect(readRoot('sunglasses-estimate.html')).not.toMatch(/키즈|안경테|기능성 안경/);
  });

  it('hides the upload areas of the manual way only while they are empty (stylesheet)', () => {
    const css = readRoot('estimate-common.css');

    expect(css).toContain('body[data-input-mode="manual"] .image-only:not(:has(.attachments-item, .image-analysis-status:not([hidden]))) { display: none; }');
    expect(css).toMatch(/body:not\(\[data-input-mode="manual"\]\) \.mode-when-manual,\s*body\[data-input-mode="manual"\] \.mode-when-image \{ display: none; \}/);
  });
});

describe('the photo box of the sunglasses page', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.window.scrollTo = () => undefined;
    loaded = loadPage('sunglasses-estimate.html', PAGE_SCRIPTS('sunglasses'));
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
  });

  it('can be reached and used with the keyboard', () => {
    const box = $('#imageUploadBox');
    const input = $('#sunglassImage');
    let opened = 0;
    input.click = () => { opened += 1; };

    expect(box.getAttribute('role')).toBe('button');
    expect(box.getAttribute('tabindex')).toBe('0');
    key(box, ' ');

    expect(opened).toBe(1);
  });

  it('puts the name of the chosen file in as text, never as markup', () => {
    const box = $('#imageUploadBox');
    const input = $('#sunglassImage');
    const file = new g.File(['x'], '<img src=x onerror=alert(1)>.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new g.Event('change', { bubbles: true }));

    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror=alert(1)>.png');
    expect(box.textContent).toContain('선택됨');
  });
});

// The sunglasses page starts with a photo (2026-11-17): the kind is chosen, one click goes to step 2 and opens the photo chooser.
describe('the photo first start of the sunglasses page', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.window.scrollTo = () => undefined;
    g.document.body.removeAttribute('data-input-mode');
    loaded = loadPage('sunglasses-estimate.html', PAGE_SCRIPTS('sunglasses'));
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
  });

  it('has the golf and sports sunglasses chosen, and the other kind can still be picked', () => {
    expect($('.category-card[data-category="sports"]').classList.contains('selected')).toBe(true);
    click($('.category-card[data-category="sunglasses"]'));

    expect($('.category-card[data-category="sunglasses"]').classList.contains('selected')).toBe(true);
    expect($('.category-card[data-category="sports"]').classList.contains('selected')).toBe(false);
  });

  it('moves to step 2 and opens the photo chooser with one click on "사진 올리고 시작"', () => {
    const chooser = jest.spyOn($('#sunglassImage'), 'click');
    click($('#nextBtn1'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(g.document.body.getAttribute('data-input-mode')).toBe('image');
    // (the upload box around the input answers a click on it by clicking it again, which a browser ignores while one is under way)
    expect(chooser).toHaveBeenCalled();
  });

  it('has one way to start only, and shows the photo in step 2 with the specification out of sight (2026-11-18)', () => {
    expect(Array.from(g.document.querySelectorAll('#step1-content .start-grid button[data-start]')).map((button: any) => button.id)).toEqual(['nextBtn1']);
    expect($('#manualBtn')).toBeNull();

    click($('#nextBtn1'));
    expect($('#photoStage').hidden).toBe(false);
    expect($('#specForm').hidden).toBe(true);
    expect($('#nextBtn2').textContent).toBe('AI 견적 시작');
  });
});

// The golf shoe page starts with a photo as well (2026-11-17): its kind is chosen by the script, one click goes to step 2 and opens the photo chooser.
describe('the photo first start of the golf shoe page', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.window.scrollTo = () => undefined;
    g.document.body.removeAttribute('data-input-mode');
    loaded = loadPage('shoes-estimate.html', PAGE_SCRIPTS('shoes'));
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
  });

  it('moves to step 2 and opens the photo chooser with one click on "사진 올리고 시작"', () => {
    const chooser = jest.spyOn($('#shoeImage'), 'click');
    click($('#nextBtn1'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(g.document.body.getAttribute('data-input-mode')).toBe('image');
    expect(chooser).toHaveBeenCalled();
  });

  it('has one way to start only: with a photo, because the specification is asked only in the detailed quote', () => {
    const buttons = $$('#step1-content .start-grid button[data-start]');

    expect(buttons.map((button: any) => [button.id, button.getAttribute('data-start')])).toEqual([['nextBtn1', 'image']]);
    expect($('#manualBtn')).toBeNull();
    expect($('#nextBtn1 .pick-name').textContent).toBe('사진 올리고 시작');
  });

  it('shows the photo in step 2 and keeps the specification out of sight until the detailed quote', () => {
    click($('#nextBtn1'));

    expect($('#photoStage').hidden).toBe(false);
    expect($('#specForm').hidden).toBe(true);
    expect($('#nextBtn2').textContent).toBe('AI 견적 시작');
  });
});

// The golf tee page starts with a photo as well (2026-11-18): its card is chosen by the script, one click goes to step 2 and opens the chooser.
describe('the photo first start of the golf tee page', () => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.window.scrollTo = () => undefined;
    g.document.body.removeAttribute('data-input-mode');
    loaded = loadPage('golf-estimate.html', PAGE_SCRIPTS('golf'));
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
  });

  it('has the golf tee chosen and one way to start only, which opens the photo chooser in step 2', () => {
    expect($('.category-card[data-category="golf_tee"]').classList.contains('selected')).toBe(true);
    expect($('#manualBtn')).toBeNull();
    const chooser = jest.spyOn($('#teeImage'), 'click');

    click($('#nextBtn1'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(chooser).toHaveBeenCalled();
    expect($('#photoStage').hidden).toBe(false);
    expect($('#specForm').hidden).toBe(true);
    expect($('#nextBtn2').textContent).toBe('AI 견적 시작');
  });
});
