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

// The golf shoe page has no way to start without a photo (2026-11-17): it has its own tests at the end of this file.
const PAGES: Array<{ page: string; card: string }> = [
  { page: 'sunglasses', card: 'sports' },
  { page: 'golf', card: 'golf_tee' }
];

// Step 1 of the estimate pages: the kind of product, then the two ways to start (with a reference
// image, or without one). Both lead to the same step 2; the way is kept on the body for the stylesheet.
describe.each(PAGES)('the two ways to start on the $page page', ({ page, card }) => {
  let loaded: LoadedPage | undefined;

  beforeEach(() => {
    g.window.scrollTo = () => undefined;
    g.document.body.removeAttribute('data-input-mode');
    loaded = loadPage(`${page}-estimate.html`, PAGE_SCRIPTS(page));
  });

  afterEach(() => {
    loaded?.dispose();
    loaded = undefined;
  });

  const choose = (): void => click($(`.category-card[data-category="${card}"]`));

  it('offers both ways in step 1, as buttons that are ready at once (every page has its kind chosen from the start)', () => {
    const buttons = $$('#step1-content .start-grid button[data-start]');

    expect(buttons.map(button => [button.id, button.getAttribute('data-start')])).toEqual([['nextBtn1', 'image'], ['manualBtn', 'manual']]);
    // The sunglasses page and the golf shoe page start with a photo (2026-11-17); the golf tee page keeps the way it had.
    expect($('#nextBtn1 .pick-name').textContent).toBe(page === 'golf' ? '참고 이미지 있음' : '사진 올리고 시작');
    expect($('#manualBtn .pick-name').textContent).toBe(page === 'golf' ? '이미지 없이 직접 입력' : '사진 없이 직접 입력');
    // The golf tee page and the golf shoe page have one kind and choose it themselves; the sunglasses page chooses the
    // golf and sports kind, and the visitor can still pick the other one.
    expect(buttons.every(button => !button.disabled)).toBe(true);
  });

  it('goes to step 2 with the image way, and keeps every upload area', () => {
    choose();
    click($('#nextBtn1'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(g.document.body.getAttribute('data-input-mode')).toBe('image');
    expect($('#step2-content .image-only #attachments')).not.toBeNull();
  });

  it('goes to the same step 2 with the manual way: the same fields, nothing new', () => {
    choose();
    click($('#manualBtn'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#step1-content').classList.contains('active')).toBe(false);
    expect(g.document.body.getAttribute('data-input-mode')).toBe('manual');
    expect($('#nextBtn2')).not.toBeNull();
    expect($('#quantity')).not.toBeNull();
  });

  it('has a kind of product chosen from the start, so one click is enough to move on', () => {
    expect($$('.category-card.selected')).toHaveLength(1);
    click($('#manualBtn'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
  });

  it('changes the way in step 2 without leaving it or losing what was typed', () => {
    choose();
    click($('#nextBtn1'));
    $('#quantity').value = '1200';

    click($('#step2-content .mode-when-image [data-start="manual"]'));
    expect(g.document.body.getAttribute('data-input-mode')).toBe('manual');
    click($('#step2-content .mode-when-manual [data-start="image"]'));
    expect(g.document.body.getAttribute('data-input-mode')).toBe('image');

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#quantity').value).toBe('1200');
  });

  it('lets the keyboard choose a kind of product: the cards are buttons to it', () => {
    const target = $(`.category-card[data-category="${card}"]`);

    expect(target.getAttribute('role')).toBe('button');
    expect(target.getAttribute('tabindex')).toBe('0');
    $$('.category-card').forEach(other => other.classList.remove('selected'));
    const event = key(target, 'Enter');

    expect(event.defaultPrevented).toBe(true);
    expect(target.classList.contains('selected')).toBe(true);
    expect(target.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('what the two ways say and hide', () => {
  it('says on the golf tee page only that the photo analysis is for sunglasses and golf shoes, and gives the golf shoe page its photo box', () => {
    expect(readRoot('sunglasses-estimate.html')).toContain('AI가 재질과 렌즈를 추정해 항목을 채워 줍니다');
    const tee = readRoot('golf-estimate.html');
    expect(tee).toContain('사진 AI 분석은 선글라스에서만 지원합니다');
    expect(tee).not.toContain('id="imageUploadBox"');
    const shoes = readRoot('shoes-estimate.html');
    expect(shoes).not.toContain('사진 AI 분석은 선글라스에서만 지원합니다');
    expect(shoes).toContain('id="imageUploadBox"');
    expect(shoes).toContain('AI가 조임 방식·아웃솔·어퍼 재질을 추정');
  });

  it('says what needs no account and when one is needed', () => {
    expect(readRoot('sunglasses-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b>[^<]*견적 요청까지 접수할 수 있습니다\. <b>담당자 상세견적<\/b>[^<]*로그인이 필요합니다\.<\/p>/);
    expect(readRoot('golf-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b> 예상 가격 범위를 보고 견적 요청까지 접수할 수 있습니다\.<\/p>/);
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

  it('does not open the photo chooser when the visitor starts without a photo', () => {
    const chooser = jest.spyOn($('#sunglassImage'), 'click');
    click($('#manualBtn'));

    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect(g.document.body.getAttribute('data-input-mode')).toBe('manual');
    expect(chooser).not.toHaveBeenCalled();
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
