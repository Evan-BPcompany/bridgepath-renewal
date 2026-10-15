/**
 * @jest-environment jsdom
 */
import { API_SCRIPTS, runScript } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}

function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

let step: any;

function mount(options: Record<string, unknown> = {}): any {
  g.document.body.innerHTML = '<div id="host"></div>';
  return g.BridgePathCustomerStep.mount($('#host'), options);
}

beforeAll(() => {
  API_SCRIPTS.forEach(runScript);
  runScript('estimate-customer-step.js');
});

beforeEach(() => {
  step = mount();
});

describe('estimate-customer-step.js: structure', () => {
  it('asks for the customer type in a fieldset with a legend, none chosen', () => {
    const set = $('#customerTypeGroup');
    expect(set.tagName).toBe('FIELDSET');
    expect(set.querySelector('legend').textContent).toBe('고객 유형 *');
    const radios = $$('input[name="customer_type"]');
    expect(radios.map(radio => radio.value)).toEqual(['individual_startup', 'business_brand']);
    expect(radios.every(radio => radio.type === 'radio' && !radio.checked)).toBe(true);
    expect($('label[for="customerTypeIndividual"]').textContent).toBe('개인·창업 준비 중');
    expect($('label[for="customerTypeBusiness"]').textContent).toBe('사업자·브랜드 운영 중');
  });

  it('shows the hint (not for consumers) and keeps it in the description of the radios', () => {
    const hint = $('#customerTypeHint');
    expect(hint.textContent).toBe(g.BridgePathEstimate.CUSTOMER_TYPE_HINT);
    expect(hint.textContent).toContain('일반 소비자용이 아니에요');
    step.validate();
    $$('input[name="customer_type"]').forEach(radio => {
      expect(radio.getAttribute('aria-describedby')).toBe('customerTypeHint customerTypeError');
    });
  });

  it('uses the right input types, autocomplete and limits', () => {
    expect($('#customerName').getAttribute('autocomplete')).toBe('name');
    expect($('#customerName').getAttribute('maxlength')).toBe('100');
    expect($('#customerCompany').getAttribute('autocomplete')).toBe('organization');
    expect($('#customerEmail').type).toBe('email');
    expect($('#customerEmail').getAttribute('autocomplete')).toBe('email');
    expect($('#customerPhone').type).toBe('tel');
    expect($('#customerPhone').getAttribute('autocomplete')).toBe('tel');
    expect($('#customerPhone').getAttribute('maxlength')).toBe('20');
  });

  it('gives every control a label and every id once', () => {
    $$('#host input').forEach(input => {
      expect($(`label[for="${input.id}"]`)).not.toBeNull();
    });
    const ids = $$('#host [id]').map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groups the two contact inputs in a fieldset whose legend says one of them is needed', () => {
    const set = $('#customerContactGroup');
    expect(set.tagName).toBe('FIELDSET');
    expect(set.querySelector('legend').textContent).toContain('이메일 또는 전화번호 중 하나는 꼭 입력');
    expect(set.querySelectorAll('input').length).toBe(2);
  });

  it('shows the consent checkbox with a link that opens in a new tab without opener', () => {
    const consent = $('#privacyConsent');
    expect(consent.type).toBe('checkbox');
    expect(consent.checked).toBe(false);
    expect($('label[for="privacyConsent"]').textContent).toBe('개인정보 수집·이용에 동의합니다 (필수)');
    const link = $('.customer-consent-link');
    expect(link.getAttribute('href')).toBe('privacy-consent.html');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('mounting again replaces the fields (no duplicate ids)', () => {
    g.BridgePathCustomerStep.mount($('#host'), {});
    expect($$('#customerName').length).toBe(1);
  });

  it('leaves out the summary of the errors in the inline mode', () => {
    mount({ inline: true });
    expect($('#customerErrorSummary')).toBeNull();
    expect($('.customer-step--inline')).not.toBeNull();
  });

  it('sets an address from outside only as an attribute, never as markup', () => {
    const odd = '"><img src=x onerror=alert(1)>';
    mount({ consentUrl: odd });
    expect($('#host img')).toBeNull();
    expect($('.customer-consent-link').getAttribute('href')).toBe(odd);
  });
});

describe('estimate-customer-step.js: the company field', () => {
  it('is there from the start and optional', () => {
    expect($('#customerCompany')).not.toBeNull();
    expect($('#customerCompanyLabel').textContent).toBe('회사명·브랜드명 (선택)');
    expect($('#customerCompany').getAttribute('aria-required')).toBe('false');
  });

  it('becomes required for a business and optional again for an individual, keeping the text', () => {
    type($('#customerCompany'), 'Bridge Co');
    check($('#customerTypeBusiness'));
    expect($('#customerCompanyLabel').textContent).toBe('회사명 또는 브랜드명 *');
    expect($('#customerCompany').getAttribute('aria-required')).toBe('true');
    check($('#customerTypeIndividual'));
    expect($('#customerCompanyLabel').textContent).toBe('회사명·브랜드명 (선택)');
    expect($('#customerCompany').getAttribute('aria-required')).toBe('false');
    expect($('#customerCompany').value).toBe('Bridge Co');
  });
});

describe('estimate-customer-step.js: input and validation', () => {
  it('returns the fields under the names of the API, consent as a boolean', () => {
    check($('#customerTypeBusiness'));
    type($('#customerName'), ' Kim ');
    type($('#customerCompany'), 'Bridge');
    type($('#customerEmail'), 'a@b.co');
    type($('#customerPhone'), '010-1234-5678');
    check($('#privacyConsent'));
    expect(step.getInput()).toEqual({
      customer_type: 'business_brand',
      customer_name: ' Kim ',
      company_name: 'Bridge',
      customer_email: 'a@b.co',
      customer_phone: '010-1234-5678',
      privacy_consent: true
    });
  });

  it('accepts a complete input and shows nothing', () => {
    check($('#customerTypeIndividual'));
    type($('#customerName'), 'Kim');
    type($('#customerEmail'), 'a@b.co');
    check($('#privacyConsent'));
    const result = step.validate({ focus: true });
    expect(result.valid).toBe(true);
    expect($('#customerErrorSummary').hidden).toBe(true);
    expect($$('.field-error').every(box => box.hidden)).toBe(true);
    expect($$('[aria-invalid]').length).toBe(0);
  });

  it('shows what is missing in an empty form, counts it and puts the focus on the first control', () => {
    const result = step.validate({ focus: true });
    expect(result.valid).toBe(false);
    expect($('#customerTypeError').textContent).not.toBe('');
    expect($('#customerNameError').textContent).not.toBe('');
    expect($('#customerContactError').textContent).not.toBe('');
    expect($('#privacyConsentError').textContent).not.toBe('');
    const summary = $('#customerErrorSummary');
    expect(summary.hidden).toBe(false);
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.textContent).toBe('확인이 필요한 항목이 4개 있어요.');
    expect(g.document.activeElement).toBe($('#customerTypeIndividual'));
  });

  it('does not move the focus without the option', () => {
    step.validate();
    expect(g.document.activeElement).toBe(g.document.body);
  });

  it('marks the controls invalid and points them to their message', () => {
    step.validate();
    expect($('#customerName').getAttribute('aria-invalid')).toBe('true');
    expect($('#customerName').getAttribute('aria-describedby')).toBe('customerNameError');
    expect($('#privacyConsent').getAttribute('aria-invalid')).toBe('true');
    expect($('#privacyConsent').getAttribute('aria-describedby')).toBe('privacyConsentError');
  });

  it('refers to the message of the contact group from both inputs', () => {
    step.validate();
    ['#customerEmail', '#customerPhone'].forEach(selector => {
      expect($(selector).getAttribute('aria-invalid')).toBe('true');
      expect($(selector).getAttribute('aria-describedby')).toBe('customerContactError');
    });
  });

  it('puts the focus in the order type, name, company, email, consent', () => {
    const order: Array<[() => void, string]> = [
      [() => undefined, '#customerTypeIndividual'],
      [() => check($('#customerTypeBusiness')), '#customerName'],
      [() => type($('#customerName'), 'Kim'), '#customerCompany'],
      [() => type($('#customerCompany'), 'Bridge'), '#customerEmail'],
      [() => type($('#customerEmail'), 'a@b.co'), '#privacyConsent']
    ];
    order.forEach(([fill, expected]) => {
      fill();
      step.validate({ focus: true });
      expect(g.document.activeElement).toBe($(expected));
    });
  });

  it('asks for the company only from a business', () => {
    check($('#customerTypeIndividual'));
    type($('#customerName'), 'Kim');
    type($('#customerEmail'), 'a@b.co');
    check($('#privacyConsent'));
    expect(step.validate().valid).toBe(true);
    check($('#customerTypeBusiness'));
    const result = step.validate({ focus: true });
    expect(result.valid).toBe(false);
    expect($('#customerCompanyError').hidden).toBe(false);
    expect($('#customerCompany').getAttribute('aria-invalid')).toBe('true');
    expect(g.document.activeElement).toBe($('#customerCompany'));
  });

  it('puts a wrong e-mail on the e-mail field, not on the group', () => {
    check($('#customerTypeIndividual'));
    type($('#customerName'), 'Kim');
    type($('#customerEmail'), 'not-an-email');
    check($('#privacyConsent'));
    const result = step.validate({ focus: true });
    expect(result.errors.map((error: any) => error.field)).toEqual(['customer_email']);
    expect($('#customerEmailError').hidden).toBe(false);
    expect($('#customerContactError').hidden).toBe(true);
    expect(g.document.activeElement).toBe($('#customerEmail'));
  });

  it('takes away a message as soon as its field is changed, and the summary follows', () => {
    step.validate();
    expect($('#customerErrorSummary').textContent).toBe('확인이 필요한 항목이 4개 있어요.');
    type($('#customerName'), 'K');
    expect($('#customerNameError').hidden).toBe(true);
    expect($('#customerName').getAttribute('aria-invalid')).toBeNull();
    expect($('#customerName').getAttribute('aria-describedby')).toBeNull();
    expect($('#customerErrorSummary').textContent).toBe('확인이 필요한 항목이 3개 있어요.');
    check($('#privacyConsent'));
    check($('#customerTypeIndividual'));
    type($('#customerEmail'), 'a');
    expect($('#customerContactError').hidden).toBe(true);
    expect($('#customerPhone').getAttribute('aria-invalid')).toBeNull();
    expect($('#customerErrorSummary').hidden).toBe(true);
  });

  it('clears the company message when the type changes', () => {
    check($('#customerTypeBusiness'));
    step.validate();
    expect($('#customerCompanyError').hidden).toBe(false);
    check($('#customerTypeIndividual'));
    expect($('#customerCompanyError').hidden).toBe(true);
  });

  it('shows the limit in the message of a text that is too long', () => {
    type($('#customerName'), 'x'.repeat(101));
    step.validate();
    expect($('#customerNameError').textContent).toContain('100');
  });

  it('shows text that looks like markup as text, never as elements', () => {
    const attack = '<img src=x onerror=alert(1)>';
    check($('#customerTypeIndividual'));
    type($('#customerName'), attack);
    type($('#customerEmail'), attack);
    step.validate();
    expect($('#host img')).toBeNull();
    expect($('#customerEmailError').textContent).not.toContain('<img');
  });

  it('shows errors that come from the server by field and ignores unknown fields', () => {
    step.showServerErrors([
      { field: 'customer_email', code: 'invalid_email' },
      { field: 'customer_name', code: 'too_long', max: 100 },
      { field: 'nothing_like_it', code: 'invalid' }
    ]);
    expect($('#customerEmailError').hidden).toBe(false);
    expect($('#customerNameError').textContent).toContain('100');
    expect($('#customerErrorSummary').textContent).toBe('확인이 필요한 항목이 2개 있어요.');
    expect(g.document.activeElement).toBe($('#customerName'));
  });

  it('resets everything', () => {
    check($('#customerTypeBusiness'));
    type($('#customerName'), 'Kim');
    check($('#privacyConsent'));
    step.validate();
    step.reset();
    expect(step.getInput()).toEqual({
      customer_type: '',
      customer_name: '',
      company_name: '',
      customer_email: '',
      customer_phone: '',
      privacy_consent: false
    });
    expect($('#customerCompanyLabel').textContent).toBe('회사명·브랜드명 (선택)');
    expect($('#customerErrorSummary').hidden).toBe(true);
    expect($$('[aria-invalid]').length).toBe(0);
  });
});
