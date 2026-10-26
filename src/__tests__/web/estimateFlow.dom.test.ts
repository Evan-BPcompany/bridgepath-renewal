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

function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

function click(element: any): void {
  element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// A valid product input for each page, and the card to choose in step 1.
const PAGES: Array<{ page: string; card: string; fill: () => void; required: string[] }> = [
  {
    page: 'sunglasses',
    card: 'optical',
    required: ['lensType', 'frameMaterial'],
    fill: () => {
      choose($('#lensType'), 'normal');
      choose($('#frameMaterial'), 'metal');
      type($('#quantity'), '100');
    }
  },
  {
    page: 'shoes',
    card: 'sneakers',
    required: ['material'],
    fill: () => {
      choose($('#material'), 'leather');
      check($('#size250'));
      type($('#quantity'), '600');
    }
  },
  {
    page: 'golf',
    card: 'golf_tee',
    required: ['material'],
    fill: () => {
      choose($('#material'), 'wood');
      type($('#quantity'), '1000');
    }
  }
];

let loaded: LoadedPage | undefined;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  g.alert = jest.fn();
  g.scrollTo = jest.fn(); // goToStep scrolls to the top; jsdom does not implement it
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  loaded?.dispose();
  loaded = undefined;
  logSpy.mockRestore();
  jest.useRealTimers();
});

function open(page: string, card?: string): void {
  loaded = loadPage(`${page}-estimate.html`, PAGE_SCRIPTS(page));
  if (card) {
    const target = $$('.category-card').find(element => element.getAttribute('data-category') === card);
    expect(target).toBeDefined();
    click(target);
    click($('#nextBtn1'));
  }
}


describe.each(PAGES)('$page estimate page: the three steps', ({ page, card, fill, required }) => {
  it('starts on step 1 with three steps in the indicator and the customer form mounted in step 3', () => {
    open(page);
    expect($$('.step-indicator .step').map(step => step.id)).toEqual(['step1', 'step2', 'step3']);
    expect($('#step1-content').classList.contains('active')).toBe(true);
    expect($('#step3-content #customerStep fieldset')).not.toBeNull();
    expect($('#step3-content #submitBtn')).not.toBeNull();
  });

  it('goes from step 1 to step 2 as before', () => {
    open(page, card);
    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#step3-content').classList.contains('active')).toBe(false);
  });

  it('keeps step 2 and shows the message when the quantity is missing', () => {
    open(page, card);
    fill();
    type($('#quantity'), '');
    click($('#nextBtn2'));
    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#step3-content').classList.contains('active')).toBe(false);
    const quantity = $('#quantity');
    expect(quantity.getAttribute('aria-invalid')).toBe('true');
    const message = $(`#${quantity.getAttribute('aria-describedby')}`);
    expect(message.className).toBe('field-error');
    expect(message.textContent).not.toBe('');
    expect(g.document.activeElement).toBe(quantity);
    expect($('#productErrorSummary').hidden).toBe(false);
    expect($('#productErrorSummary').getAttribute('role')).toBe('alert');
    expect($('#productErrorSummary').textContent).toMatch(/^확인이 필요한 항목이 \d+개 있어요\.$/);
  });

  it('rejects a quantity below 1 and above 1,000,000 and a fraction', () => {
    open(page, card);
    fill();
    ['0', '-5', '1000001', '2.5'].forEach(value => {
      type($('#quantity'), value);
      click($('#nextBtn2'));
      expect($('#quantity').getAttribute('aria-invalid')).toBe('true');
      expect($('#step3-content').classList.contains('active')).toBe(false);
    });
    type($('#quantity'), '1000000');
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
  });

  it('asks for the required selects and accepts the unknown option', () => {
    open(page, card);
    fill();
    required.forEach(id => {
      const previous = $(`#${id}`).value;
      choose($(`#${id}`), '');
      click($('#nextBtn2'));
      expect($(`#${id}`).getAttribute('aria-invalid')).toBe('true');
      expect($('#step3-content').classList.contains('active')).toBe(false);
      choose($(`#${id}`), 'unknown');
      expect($(`#${id}`).getAttribute('aria-invalid')).toBeNull();
      choose($(`#${id}`), previous);
    });
    required.forEach(id => choose($(`#${id}`), 'unknown'));
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
  });

  it('puts the focus on the first wrong control in the order of the page', () => {
    open(page, card);
    fill();
    type($('#quantity'), '');
    choose($(`#${required[0]}`), '');
    click($('#nextBtn2'));
    const wrong = $$('#step2-content [aria-invalid="true"]');
    expect(wrong.length).toBeGreaterThanOrEqual(2);
    expect(g.document.activeElement).toBe(wrong[0]);
  });

  it('takes away the message when the value is changed', () => {
    open(page, card);
    fill();
    type($('#quantity'), '');
    click($('#nextBtn2'));
    expect($$('#step2-content .field-error').length).toBeGreaterThan(0);
    type($('#quantity'), '10');
    expect($('#quantity').getAttribute('aria-invalid')).toBeNull();
    expect($$('#step2-content .field-error').length).toBe(0);
    expect($('#productErrorSummary').hidden).toBe(true);
  });

  it('moves to step 3 with a valid input, marks the step and puts the focus on its heading', () => {
    open(page, card);
    fill();
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
    expect($('#step2-content').classList.contains('active')).toBe(false);
    expect($('#step3').classList.contains('active')).toBe(true);
    expect(g.document.activeElement).toBe($('#step3-content h2'));
    expect($$('#step2-content .field-error').length).toBe(0);
  });

  it('shows no message of its own in the DOM that could carry markup', () => {
    open(page, card);
    fill();
    type($('#quantity'), '<img src=x onerror=alert(1)>');
    click($('#nextBtn2'));
    expect($('#step2-content img')).toBeNull();
  });

  it('gives the way back from step 3 to step 2 and from step 2 to step 1', () => {
    open(page, card);
    expect($('#step3-content .btn-secondary').getAttribute('onclick')).toBe('goToStep(2)');
    expect($('#step2-content .btn-secondary').getAttribute('onclick')).toBe('goToStep(1)');
  });
});

describe('estimate flow: values of the pages', () => {
  it('reads the colour of the golf page from productColor', () => {
    open('golf', 'golf_tee');
    type($('#productColor'), 'black');
    type($('#design'), 'logo');
    choose($('#material'), 'wood');
    const values = g.BridgePathFlow.collectValues('golf');
    expect(values.color).toBe('black');
    expect(values.design).toBe('logo');
    expect(values.material).toBe('wood');
    expect(values.productColor).toBeUndefined();
  });

  it('reads the sizes of the shoes page from the checked boxes', () => {
    open('shoes', 'sneakers');
    check($('#size270'));
    check($('#size250'));
    expect(g.BridgePathFlow.collectValues('shoes').sizes).toEqual(['250', '270']);
  });

  it('asks for a size on the shoes page and puts the focus on the first size', () => {
    open('shoes', 'sneakers');
    choose($('#material'), 'leather');
    type($('#quantity'), '600');
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(false);
    expect($('#size220').getAttribute('aria-invalid')).toBe('true');
    expect(g.document.activeElement).toBe($('#size220'));
    check($('#size220'));
    expect($('#size220').getAttribute('aria-invalid')).toBeNull();
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
  });

  it('accepts the card "기타" of the shoes page', () => {
    open('shoes', 'other');
    choose($('#material'), 'unknown');
    check($('#size260'));
    type($('#quantity'), '600');
    click($('#nextBtn2'));
    expect($('#step3-content').classList.contains('active')).toBe(true);
  });

  it('goes back to step 1 when no card is selected', () => {
    open('sunglasses', 'optical');
    $$('.category-card').forEach(card => card.classList.remove('selected'));
    choose($('#lensType'), 'normal');
    choose($('#frameMaterial'), 'metal');
    type($('#quantity'), '5');
    click($('#nextBtn2'));
    expect($('#step1-content').classList.contains('active')).toBe(true);
  });

  it('checks the optional values too (a frame colour that is too long)', () => {
    open('sunglasses', 'optical');
    choose($('#lensType'), 'normal');
    choose($('#frameMaterial'), 'metal');
    type($('#quantity'), '5');
    type($('#frameColor'), 'x'.repeat(101));
    click($('#nextBtn2'));
    expect($('#frameColor').getAttribute('aria-invalid')).toBe('true');
    expect($('#step3-content').classList.contains('active')).toBe(false);
  });
});
