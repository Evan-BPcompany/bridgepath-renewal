/**
 * @jest-environment jsdom
 */
import { readRoot } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

// The start of the AI estimate (estimate.html): three representative products, each with the way its quote really
// starts, and a quieter box for everything else. The words are the ones of the home page.
describe('estimate.html: the representative products and the way to everything else', () => {
  const html = readRoot('estimate.html');
  const doc = new g.DOMParser().parseFromString(html, 'text/html');
  const $$ = (selector: string): any[] => Array.from(doc.querySelectorAll(selector));
  const text = (element: any): string => (element.textContent || '').replace(/\s+/g, ' ').trim();

  it('names the three as the representative products of the quick AI estimate, not as everything that is sourced', () => {
    expect(text(doc.querySelector('.flow-title'))).toBe('빠른 AI 가상견적이 가능한 대표 품목');
    expect(text(doc.querySelector('.flow-lead'))).toBe(
      '아래 대표 품목은 빠른 AI 가상견적 또는 담당 에이전트 확인으로 시작할 수 있습니다. 그 외 골프용품은 별도 문의를 통해 소싱 가능 여부를 확인해드립니다.'
    );
  });

  it('keeps the three cards and their links, and shows on each the way its quote starts', () => {
    const cards = $$('.pick-three .pick');

    expect(cards.map(card => card.getAttribute('href'))).toEqual(['sunglasses-estimate.html', 'shoes-estimate.html', 'golf-estimate.html']);
    expect(cards.map(card => text(card.querySelector('.pick-name')))).toEqual(['골프 선글라스', '골프화', '골프티']);
    expect(cards.map(card => text(card.querySelector('.pick-way')))).toEqual(['AI 가상견적', 'AI 가상견적', 'AI 가상견적']);
    expect(cards.map(card => text(card.querySelector('.pick-hint')))).toEqual([
      '사진이나 직접 입력한 기본 정보를 바탕으로 예상 가격 범위를 확인할 수 있습니다.',
      '재질과 수량을 입력하면 예상 가격 범위를 확인할 수 있습니다.',
      '재질과 수량을 입력하면 예상 가격 범위를 확인할 수 있습니다.'
    ]);
  });

  it('labels all three as AI estimates because all three pages really show a price range: the sunglasses through the photo/preview scripts, the shoes and the golf tee through the market preview', () => {
    for (const page of ['shoes-estimate.html', 'golf-estimate.html']) {
      const source = readRoot(page);

      expect(source).toContain('<script src="estimate-market-preview.js"></script>');
      expect(source).toContain('id="marketPreview"');
    }
    expect(readRoot('sunglasses-estimate.html')).toContain('<script src="estimate-preview.js"></script>');
    // the shoes are previewed by the server with their own rules, as the golf tee is
    expect(readRoot('src/routes/estimatePreview.ts')).toContain('previewShoes');
  });

  it('puts everything else in a box under the cards, not in a fourth card, and links it to the inquiry that exists', () => {
    const box = doc.querySelector('.other-box');

    expect($$('.pick-grid > li')).toHaveLength(3);
    expect(box).not.toBeNull();
    expect(box.compareDocumentPosition(doc.querySelector('.pick-grid')) & 2).toBe(2); // the cards come before the box
    expect(text(box.querySelector('.other-title'))).toBe('그 외 골프용품도 소싱 가능합니다.');
    expect(text(box.querySelector('.other-text'))).toBe('골프모자, 골프장갑, 볼마커, 볼타월 등 원하는 품목은 담당 에이전트에게 문의해 주세요.');
    expect(text(box.querySelector('.other-sub'))).toBe('AI 가상견적이 제공되지 않는 품목은 요청 접수 후 담당 에이전트가 소싱 가능 여부와 제작 조건을 확인해 안내합니다.');
    expect(box.getAttribute('aria-labelledby')).toBe('otherTitle');
    expect(doc.getElementById('otherTitle')).not.toBeNull();
    const button = box.querySelector('a.other-btn');
    expect(button.getAttribute('href')).toBe('other-inquiry.html');
    expect(text(button)).toBe('다른 골프용품 소싱 문의');
    expect(readRoot('other-inquiry.html')).toContain('<h1>다른 골프용품 문의</h1>');
  });

  it('does not state an order minimum, a limit on clubs or balls, or any promise the code does not make', () => {
    const body = text(doc.querySelector('main'));

    expect(body).not.toMatch(/최소 주문|600켤레|1,000패키지|골프채|골프공|보장|확정됩니다/);
  });

  it('keeps the way back, the navigation and the skip link', () => {
    expect(doc.querySelector('.panel-back').getAttribute('href')).toBe('index.html');
    expect(doc.querySelector('.panel-back').getAttribute('aria-label')).toBe('홈으로 돌아가기');
    expect(doc.querySelector('.site-cta').getAttribute('aria-current')).toBe('page');
    expect($$('.site-nav a').map(a => a.getAttribute('href'))).toEqual(['my-quotes.html', 'login.html', 'estimate.html']);
    expect(doc.querySelector('a.skip').getAttribute('href')).toBe('#start');
  });
});
