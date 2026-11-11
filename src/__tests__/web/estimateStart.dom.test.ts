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

const PAGES: Array<{ page: string; card: string }> = [
  { page: 'sunglasses', card: 'sports' },
  { page: 'shoes', card: 'other' },
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

  it('offers both ways in step 1, as buttons that wait for the kind of product', () => {
    const buttons = $$('#step1-content .start-grid button[data-start]');

    expect(buttons.map(button => [button.id, button.getAttribute('data-start')])).toEqual([['nextBtn1', 'image'], ['manualBtn', 'manual']]);
    expect($('#nextBtn1 .pick-name').textContent).toBe('참고 이미지가 있어요');
    expect($('#manualBtn .pick-name').textContent).toBe('이미지 없이 직접 입력할게요');
    if (page === 'sunglasses') {
      // The golf tee page and the golf shoe page have one kind and choose it themselves.
      expect(buttons.every(button => button.disabled)).toBe(true);
      choose();
    }
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

  it('does not move on without a kind of product', () => {
    if (page !== 'sunglasses') {
      return;
    }
    const manual = $('#manualBtn');
    manual.disabled = false;
    click(manual);

    expect($('#step1-content').classList.contains('active')).toBe(true);
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
  it('says on the shoes and golf tee pages that the photo analysis is for sunglasses only', () => {
    expect(readRoot('sunglasses-estimate.html')).toContain('AI가 재질과 렌즈를 추정해 항목을 채워 줘요');
    for (const page of ['shoes', 'golf']) {
      const html = readRoot(`${page}-estimate.html`);
      expect(html).toContain('사진 AI 분석은 선글라스에서만 지원해요');
      expect(html).not.toContain('id="imageUploadBox"');
    }
  });

  it('says what needs no account and when one is needed', () => {
    expect(readRoot('sunglasses-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b>[^<]*견적 요청까지 접수할 수 있어요\. <b>담당자 상세견적<\/b>[^<]*로그인이 필요해요\.<\/p>/);
    expect(readRoot('golf-estimate.html')).toMatch(/<p class="scope-note"><b>로그인 없이<\/b> 예상 가격 범위를 보고 견적 요청까지 접수할 수 있어요\.<\/p>/);
    // The golf shoe page has no price to show yet, and says so instead of promising a range.
    const shoes = readRoot('shoes-estimate.html');
    expect(shoes).toMatch(/<p class="scope-note"><b>로그인 없이<\/b> 견적 요청까지 접수할 수 있어요\. 골프화는 아직 예상 가격 범위를 바로 안내하지 못해요\.[^<]*<\/p>/);
    expect(shoes.slice(shoes.indexOf('id="step1-content"'), shoes.indexOf('id="step2-content"'))).not.toContain('예상 가격 범위를 확인해요');
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
