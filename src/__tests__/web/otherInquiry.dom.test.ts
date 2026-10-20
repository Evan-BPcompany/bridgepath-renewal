/**
 * @jest-environment jsdom
 */
import { loadPage, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const SCRIPTS = ['config.js', 'estimate-api.js', 'estimate-customer-step.js', 'estimate-submit.js', 'other-inquiry.js'];
const SERVER_MESSAGE = '접수 내용을 확인한 뒤 안내드립니다. (서버가 보낸 고정 문구)';

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}
function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}
function submitForm(): void {
  $('#inquiryForm').dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};
function reply(status: number, body: unknown, headers: Record<string, string> = {}): any {
  return { status, headers: { get: (name: string) => headers[name] ?? null }, json: async () => body };
}

const CREATED = {
  receipt_id: 'BP-20261015-0007',
  created_at: '2026-10-15T03:04:05.000Z',
  message: SERVER_MESSAGE,
  access_token: 'SECRET-TOKEN-VALUE-abc123',
  status: 'new_receipt',
  id: 42
};

let loaded: LoadedPage | undefined;
let fetchMock: jest.Mock;
let logSpy: jest.SpyInstance;
let alertMock: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  alertMock = jest.fn();
  g.alert = alertMock;
  fetchMock = jest.fn();
  g.fetch = fetchMock;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  loaded = loadPage('other-inquiry.html', SCRIPTS);
});

afterEach(() => {
  loaded?.dispose();
  loaded = undefined;
  logSpy.mockRestore();
  delete g.fetch;
  jest.useRealTimers();
});

function fillProduct(): void {
  type($('#productDescription'), '맞춤형 텀블러 (로고 인쇄)');
  type($('#quantity'), '1000');
}
function fillCustomer(): void {
  check($('#customerTypeIndividual'));
  type($('#customerName'), 'Kim Minsu');
  type($('#customerEmail'), 'buyer@example.com');
  check($('#privacyConsent'));
}
async function sendOk(): Promise<void> {
  fetchMock.mockResolvedValue(reply(201, CREATED));
  submitForm();
  await flush();
}

describe('other-inquiry page: the form', () => {
  it('mounts the customer information in the form, before the button, and the summary of the product on top', () => {
    expect($('#inquiryForm #customerStep fieldset')).not.toBeNull();
    const order = $$('#inquiryForm *').map(element => element.id);
    expect(order.indexOf('customerTypeGroup')).toBeGreaterThan(order.indexOf('deliveryDate'));
    expect(order.indexOf('customerTypeGroup')).toBeLessThan(order.indexOf('submitBtn'));
    expect($('#inquiryForm').firstElementChild.id).toBe('productErrorSummary');
    expect($('#inquiryForm').hasAttribute('novalidate')).toBe(true);
  });

  it('shows the upload box but disabled, with the note, and takes no file', () => {
    expect($('#productImage').disabled).toBe(true);
    expect($('#imageUploadBox').getAttribute('aria-disabled')).toBe('true');
    expect($('#imageDisabledNote').textContent).toBe('지금은 이미지를 첨부할 수 없어요. 제품 설명에 참고할 내용을 적어 주세요.');
    $('#imageUploadBox').dispatchEvent(new g.Event('click', { bubbles: true }));
    $('#imageUploadBox').dispatchEvent(new g.Event('drop', { bubbles: true, cancelable: true }));
    expect($('#imageUploadBox').querySelector('input').disabled).toBe(true);
    expect($('#imageUploadBox').children.length).toBe(3);
  });

  it('has the optional special requirements field under the description', () => {
    const area = $('#additionalInfo');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('maxlength')).toBe('2000');
    expect($('label[for="additionalInfo"]').textContent).toBe('추가 요청사항 (선택)');
  });
});

describe('other-inquiry page: checking before sending', () => {
  it('sends nothing from an empty form and shows the errors of the product and of the customer together', async () => {
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#productErrorSummary').hidden).toBe(false);
    expect($('#productErrorSummary').textContent).toMatch(/^확인이 필요한 항목이 2개 있어요\.$/);
    expect($('#productDescription').getAttribute('aria-invalid')).toBe('true');
    expect($('#quantity').getAttribute('aria-invalid')).toBe('true');
    expect($('#customerErrorSummary').hidden).toBe(false);
    expect($('#customerErrorSummary').textContent).toBe('확인이 필요한 항목이 4개 있어요.');
    expect(g.document.activeElement).toBe($('#productDescription'));
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('puts the focus on the customer only when the product input is right', async () => {
    fillProduct();
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#productErrorSummary').hidden).toBe(true);
    expect(g.document.activeElement).toBe($('#customerTypeIndividual'));
  });

  it('asks for a description that is not only blanks', async () => {
    type($('#productDescription'), '   ');
    type($('#quantity'), '10');
    fillCustomer();
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#productDescription').getAttribute('aria-invalid')).toBe('true');
  });

  it.each(['', '0', '-4', '2.5', '1000001', 'abc'])('rejects the quantity "%s"', async value => {
    type($('#productDescription'), 'a tumbler');
    type($('#quantity'), value);
    fillCustomer();
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#quantity').getAttribute('aria-invalid')).toBe('true');
    expect($('#productError-quantity').textContent).not.toBe('');
  });

  it('checks the length of the special requirements and the delivery date', async () => {
    fillProduct();
    fillCustomer();
    type($('#additionalInfo'), 'x'.repeat(2001));
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#additionalInfo').getAttribute('aria-invalid')).toBe('true');
    expect($('#productError-additionalInfo').textContent).toContain('2000');
  });

  it('takes the message away when the value is changed', async () => {
    submitForm();
    await flush();
    type($('#quantity'), '10');
    expect($('#quantity').getAttribute('aria-invalid')).toBeNull();
    expect($('#productError-quantity')).toBeNull();
    expect($('#productErrorSummary').textContent).toBe('확인이 필요한 항목이 1개 있어요.');
    type($('#productDescription'), 'x');
    expect($('#productErrorSummary').hidden).toBe(true);
  });

  it('asks for the company of a business', async () => {
    fillProduct();
    fillCustomer();
    check($('#customerTypeBusiness'));
    submitForm();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#customerCompany').getAttribute('aria-invalid')).toBe('true');
    expect(g.document.activeElement).toBe($('#customerCompany'));
  });
});

describe('other-inquiry page: the request', () => {
  it('sends one JSON request with the category other and the specification', async () => {
    fillProduct();
    type($('#additionalInfo'), '  박스 포장은 별도  ');
    type($('#deliveryDate'), '2026-12-24');
    check($('#customerTypeBusiness'));
    type($('#customerName'), 'Kim Minsu');
    type($('#customerCompany'), 'Bridge Co');
    type($('#customerPhone'), '010-1234-5678');
    check($('#privacyConsent'));
    await sendOk();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('omit');
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body);
    expect(body.category).toBe('other');
    expect(body.specification_json).toEqual({
      schema_version: '1.0',
      product_description: '맞춤형 텀블러 (로고 인쇄)',
      quantity: 1000,
      delivery_date: '2026-12-24',
      special_requirements: '박스 포장은 별도'
    });
    expect(body.customer_type).toBe('business_brand');
    expect(body.customer_name).toBe('Kim Minsu');
    expect(body.company_name).toBe('Bridge Co');
    expect(body.customer_phone).toBe('010-1234-5678');
    expect(body.customer_email).toBeUndefined();
    expect(body.privacy_consent).toBe(true);
    expect(body.privacy_consent_version).toBe('dev-draft');
    expect(Object.keys(body).sort()).toEqual(
      ['category', 'company_name', 'customer_name', 'customer_phone', 'customer_type', 'privacy_consent', 'privacy_consent_version', 'specification_json']
    );
  });

  it('leaves the optional values out of the specification when they are empty', async () => {
    fillProduct();
    fillCustomer();
    await sendOk();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body.specification_json).sort()).toEqual(['product_description', 'quantity', 'schema_version']);
  });

  it('never sends a file, even when one is put in the disabled input', async () => {
    fillProduct();
    fillCustomer();
    await sendOk();
    expect(typeof fetchMock.mock.calls[0][1].body).toBe('string');
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('is sent by the button too, not only by Enter', async () => {
    fillProduct();
    fillCustomer();
    fetchMock.mockResolvedValue(reply(201, CREATED));
    const event = new g.MouseEvent('click', { bubbles: true, cancelable: true });
    $('#submitBtn').dispatchEvent(event);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('other-inquiry page: the answer', () => {
  it('shows the receipt number, the time, the fixed message and the note, and hides the form', async () => {
    fillProduct();
    fillCustomer();
    await sendOk();
    const box = $('#successMessage');
    expect(box.style.display).toBe('block');
    expect(box.getAttribute('role')).toBe('status');
    expect($('#receiptId').textContent).toBe('BP-20261015-0007');
    expect($('#receiptTime').textContent).toContain('2026');
    expect($('#receiptMessage').textContent).toBe(SERVER_MESSAGE);
    expect(box.textContent).toContain('접수번호를 메모해 주세요.');
    expect(box.querySelector('a').getAttribute('href')).toBe('index.html');
    expect($('#inquiryForm').style.display).toBe('none');
    expect(g.document.activeElement).toBe(box);
    expect($('#customerName').value).toBe('');
  });

  it('does not show, keep or log the token or the status, and does not leave the page', async () => {
    fillProduct();
    fillCustomer();
    await sendOk();
    const page = g.document.documentElement.outerHTML;
    expect(page).not.toContain('SECRET-TOKEN-VALUE-abc123');
    expect(page).not.toContain('new_receipt');
    expect(g.localStorage.length).toBe(0);
    expect(g.sessionStorage.length).toBe(0);
    expect(g.document.cookie).toBe('');
    expect(logSpy).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    const before = g.location.href;
    jest.advanceTimersByTime(60000);
    expect(g.location.href).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('shows markup from the answer as text', async () => {
    fillProduct();
    fillCustomer();
    const attack = '<img src=x onerror=alert(1)>';
    fetchMock.mockResolvedValue(reply(201, { receipt_id: attack, created_at: attack, message: attack }));
    submitForm();
    await flush();
    expect($('#receiptId').textContent).toBe(attack);
    expect($('#receiptMessage').textContent).toBe(attack);
    expect($('#successMessage img')).toBeNull();
  });

  it('leaves out the time and the message when the answer has none', async () => {
    fillProduct();
    fillCustomer();
    fetchMock.mockResolvedValue(reply(201, { receipt_id: 'BP-1' }));
    submitForm();
    await flush();
    expect($('#receiptTimeRow').hidden).toBe(true);
    expect($('#receiptMessage').hidden).toBe(true);
  });
});

describe('other-inquiry page: when it does not work', () => {
  async function failWith(response: unknown): Promise<void> {
    fillProduct();
    fillCustomer();
    if (response instanceof Error) {
      fetchMock.mockRejectedValue(response);
    } else {
      fetchMock.mockResolvedValue(response);
    }
    submitForm();
    await flush();
  }
  const shown = (): string => $('#submitError').textContent;

  it('429: tells the wait in minutes', async () => {
    await failWith(reply(429, {}, { 'Retry-After': '600' }));
    expect(shown()).toContain('10분');
    expect($('#submitError').getAttribute('role')).toBe('alert');
    expect(g.document.activeElement).toBe($('#submitError'));
  });

  it('503: says it is not ready and to call or write', async () => {
    await failWith(reply(503, { code: 'PRIVACY_CONSENT_NOT_CONFIGURED' }));
    expect(shown()).toContain('준비하고 있어요');
    expect(shown()).toContain('전화나 이메일');
  });

  it('500: its own message, nothing of the answer', async () => {
    await failWith(reply(500, { error: 'boom', stack: 'at secret/path.ts:1' }));
    expect(shown()).toContain('입력하신 내용은 그대로 남아 있으니');
    expect(shown()).not.toContain('secret/path');
  });

  it('network error: asks to check the connection and says it may have been received', async () => {
    await failWith(new TypeError('Failed to fetch'));
    expect(shown()).toContain('인터넷 연결을 확인');
    expect(shown()).toContain('이미 접수되었을 수 있으니');
    expect(shown()).not.toContain('Failed to fetch');
  });

  it('timeout: aborts after the time of the config and shows the same message', async () => {
    fillProduct();
    fillCustomer();
    fetchMock.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    submitForm();
    await flush();
    jest.advanceTimersByTime(59999);
    await flush();
    expect($('#submitError').hidden).toBe(true);
    jest.advanceTimersByTime(1);
    await flush();
    expect(shown()).toContain('인터넷 연결을 확인');
    expect($('#submitBtn').disabled).toBe(false);
  });

  it('400 on a customer field: at that field, with the focus on it', async () => {
    await failWith(reply(400, { error: 'Validation failed', details: [{ field: 'customer_email', message: 'customer_email must be a valid email address' }] }));
    expect($('#customerEmailError').hidden).toBe(false);
    expect(g.document.activeElement).toBe($('#customerEmail'));
    expect($('#customerEmail').value).toBe('buyer@example.com');
  });

  it('400 on something else: a general message, no text of the API', async () => {
    await failWith(reply(400, { error: 'Validation failed', details: ['specification_json is wrong'] }));
    expect($('#submitError').hidden).toBe(false);
    expect(shown()).not.toContain('specification_json');
  });

  it('an answer that is not understood, or a 201 without a receipt, is not a success', async () => {
    await failWith(reply(418, { token: 'SECRET-418' }));
    expect(shown()).toContain('요청을 처리하지 못했어요');
    expect(g.document.documentElement.outerHTML).not.toContain('SECRET-418');
    fetchMock.mockResolvedValue(reply(201, { created_at: '2026-10-15T00:00:00Z' }));
    submitForm();
    await flush();
    expect($('#successMessage').style.display).toBe('none');
  });

  it('keeps everything that was typed after a failure', async () => {
    await failWith(reply(500, {}));
    expect($('#productDescription').value).toBe('맞춤형 텀블러 (로고 인쇄)');
    expect($('#quantity').value).toBe('1000');
    expect($('#customerName').value).toBe('Kim Minsu');
    expect($('#privacyConsent').checked).toBe(true);
  });
});

describe('other-inquiry page: one request at a time', () => {
  it('sends once for a double submit and locks the form while the request is on the way', async () => {
    fillProduct();
    fillCustomer();
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    submitForm();
    submitForm();
    await flush();
    submitForm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect($('#submitBtn').disabled).toBe(true);
    expect($('#submitBtn').getAttribute('aria-busy')).toBe('true');
    expect($('#submitBtn').textContent).toBe('보내는 중…');
    expect($('#productDescription').disabled).toBe(true);
    expect($('#customerName').disabled).toBe(true);
    finish(reply(201, CREATED));
    await flush();
    submitForm();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives the form back after a failure, keeps the disabled upload disabled, and sends again', async () => {
    fillProduct();
    fillCustomer();
    fetchMock.mockResolvedValueOnce(reply(500, {}));
    submitForm();
    await flush();
    expect($('#submitBtn').disabled).toBe(false);
    expect($('#submitBtn').getAttribute('aria-busy')).toBeNull();
    expect($('#submitBtn').textContent).toBe('문의하기');
    expect($('#productDescription').disabled).toBe(false);
    expect($('#customerName').disabled).toBe(false);
    expect($('#productImage').disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(reply(201, CREATED));
    submitForm();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect($('#successMessage').style.display).toBe('block');
  });
});
