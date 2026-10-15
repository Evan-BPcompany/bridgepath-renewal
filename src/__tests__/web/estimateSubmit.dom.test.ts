/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const SERVER_MESSAGE = '접수 내용을 확인한 뒤 안내드립니다. (서버가 보낸 고정 문구)';

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
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

function reply(status: number, body: unknown, headers: Record<string, string> = {}): any {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body
  };
}

const CREATED = {
  receipt_id: 'BP-20261015-0001',
  created_at: '2026-10-15T03:04:05.000Z',
  message: SERVER_MESSAGE,
  access_token: 'SECRET-TOKEN-VALUE-abc123',
  status: 'new_receipt',
  id: 42
};

const PAGES: Array<{ page: string; card: string; category: string; fill: () => void; expectSpec: Record<string, unknown> }> = [
  {
    page: 'sunglasses',
    card: 'optical',
    category: 'eyewear',
    fill: () => {
      choose($('#lensType'), 'polarized');
      choose($('#frameMaterial'), 'unknown');
      type($('#quantity'), '300');
    },
    expectSpec: { frame_type: 'optical', material: 'unknown', lens_type: 'polarized', quantity: 300 }
  },
  {
    page: 'shoes',
    card: 'other',
    category: 'shoes',
    fill: () => {
      choose($('#material'), 'leather');
      check($('#size250'));
      check($('#size270'));
      type($('#quantity'), '120');
    },
    expectSpec: { shoe_type: 'other', material: 'leather', sizes: [250, 270], quantity: 120 }
  },
  {
    page: 'golf',
    card: 'gloves',
    category: 'golf_products',
    fill: () => {
      choose($('#material'), 'leather');
      type($('#productColor'), 'black');
      type($('#quantity'), '50');
    },
    expectSpec: { product_type: 'gloves', material: 'leather', color: 'black', quantity: 50 }
  }
];

let loaded: LoadedPage | undefined;
let fetchMock: jest.Mock;
let logSpy: jest.SpyInstance;
let alertMock: jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  g.scrollTo = jest.fn();
  alertMock = jest.fn();
  g.alert = alertMock;
  fetchMock = jest.fn();
  g.fetch = fetchMock;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  loaded?.dispose();
  loaded = undefined;
  logSpy.mockRestore();
  delete g.fetch;
  jest.useRealTimers();
  try {
    g.localStorage.clear();
    g.sessionStorage.clear();
  } catch {
    // not available
  }
});

function openAtStep3(entry: (typeof PAGES)[number]): void {
  loaded = loadPage(`${entry.page}-estimate.html`, PAGE_SCRIPTS(entry.page));
  click($$('.category-card').find(card => card.getAttribute('data-category') === entry.card));
  click($('#nextBtn1'));
  entry.fill();
  click($('#nextBtn2'));
  expect($('#step3-content').classList.contains('active')).toBe(true);
}

function fillCustomer(): void {
  check($('#customerTypeBusiness'));
  type($('#customerName'), 'Kim Minsu');
  type($('#customerCompany'), 'Bridge Co');
  type($('#customerEmail'), 'buyer@example.com');
  check($('#privacyConsent'));
}

async function submitOk(): Promise<void> {
  fetchMock.mockResolvedValue(reply(201, CREATED));
  click($('#submitBtn'));
  await flush();
}

describe.each(PAGES)('$page estimate page: sending the request', entry => {
  it('sends nothing while the customer information is wrong, and shows the errors', async () => {
    openAtStep3(entry);
    click($('#submitBtn'));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#customerErrorSummary').hidden).toBe(false);
    expect(g.document.activeElement).toBe($('#customerTypeIndividual'));
  });

  it('sends one JSON request with the category, the specification and the consent', async () => {
    openAtStep3(entry);
    fillCustomer();
    await submitOk();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('omit');
    expect(typeof init.body).toBe('string');
    const body = JSON.parse(init.body);
    expect(body.category).toBe(entry.category);
    expect(body.customer_type).toBe('business_brand');
    expect(body.customer_name).toBe('Kim Minsu');
    expect(body.company_name).toBe('Bridge Co');
    expect(body.customer_email).toBe('buyer@example.com');
    expect(body.customer_phone).toBeUndefined();
    expect(body.privacy_consent).toBe(true);
    expect(body.privacy_consent_version).toBe('dev-draft');
    expect(body.specification_json).toMatchObject(entry.expectSpec);
    expect(Object.keys(body).sort()).toEqual(
      ['category', 'company_name', 'customer_email', 'customer_name', 'customer_type', 'privacy_consent', 'privacy_consent_version', 'specification_json']
    );
    expect(body.files).toBeUndefined();
  });

  it('shows the receipt number, the time and the message of the server, and the note to write the number down', async () => {
    openAtStep3(entry);
    fillCustomer();
    await submitOk();
    const box = $('#successMessage');
    expect(box.style.display).toBe('block');
    expect(box.getAttribute('role')).toBe('status');
    expect($('#receiptId').textContent).toBe('BP-20261015-0001');
    expect($('#receiptTimeRow').hidden).toBe(false);
    expect($('#receiptTime').textContent).toContain('2026');
    expect($('#receiptMessage').hidden).toBe(false);
    expect($('#receiptMessage').textContent).toBe(SERVER_MESSAGE);
    expect(box.textContent).toContain('접수번호를 메모해 주세요.');
    expect(box.querySelector('a').getAttribute('href')).toBe('index.html');
    expect(g.document.activeElement).toBe(box);
    expect($('#customerStep').style.display).toBe('none');
    expect($('#step3-content .form-buttons').style.display).toBe('none');
    expect($('#submitError').hidden).toBe(true);
  });

  it('does not show, keep or log the token or the status of the answer', async () => {
    openAtStep3(entry);
    fillCustomer();
    await submitOk();
    const page = g.document.documentElement.outerHTML;
    expect(page).not.toContain('SECRET-TOKEN-VALUE-abc123');
    expect(page).not.toContain('new_receipt');
    expect(g.localStorage.length).toBe(0);
    expect(g.sessionStorage.length).toBe(0);
    expect(g.document.cookie).toBe('');
    expect(g.location.href).not.toContain('SECRET');
    expect(g.location.hash).toBe('');
    expect(logSpy).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('does not leave the page by itself', async () => {
    openAtStep3(entry);
    fillCustomer();
    await submitOk();
    const before = g.location.href;
    jest.advanceTimersByTime(60000);
    expect(g.location.href).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears the personal data from the form after a success', async () => {
    openAtStep3(entry);
    fillCustomer();
    await submitOk();
    expect(g.BridgePathCustomerStep).toBeDefined();
    expect($('#customerName').value).toBe('');
    expect($('#customerEmail').value).toBe('');
    expect($('#privacyConsent').checked).toBe(false);
  });

  it('allows only one request while it is on the way and after a success', async () => {
    openAtStep3(entry);
    fillCustomer();
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    click($('#submitBtn'));
    click($('#submitBtn'));
    $('#submitBtn').dispatchEvent(new g.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect($('#submitBtn').disabled).toBe(true);
    expect($('#submitBtn').getAttribute('aria-busy')).toBe('true');
    expect($('#submitBtn').textContent).toBe('보내는 중…');
    expect($('#customerName').disabled).toBe(true);
    expect($('#step3-content .btn-secondary').disabled).toBe(true);
    finish(reply(201, CREATED));
    await flush();
    click($('#submitBtn'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives the form back after a failure so that it can be sent again, with the input kept', async () => {
    openAtStep3(entry);
    fillCustomer();
    fetchMock.mockResolvedValueOnce(reply(500, { error: 'boom' }));
    click($('#submitBtn'));
    await flush();
    expect($('#submitBtn').disabled).toBe(false);
    expect($('#submitBtn').getAttribute('aria-busy')).toBeNull();
    expect($('#submitBtn').textContent).toBe('견적 요청하기');
    expect($('#customerName').disabled).toBe(false);
    expect($('#customerName').value).toBe('Kim Minsu');
    expect($('#successMessage').style.display).toBe('none');
    fetchMock.mockResolvedValueOnce(reply(201, CREATED));
    click($('#submitBtn'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect($('#successMessage').style.display).toBe('block');
  });
});

describe('estimate submit: what the answers look like to the visitor', () => {
  const entry = PAGES[0];

  async function failWith(response: unknown): Promise<void> {
    openAtStep3(entry);
    fillCustomer();
    if (response instanceof Error) {
      fetchMock.mockRejectedValue(response);
    } else {
      fetchMock.mockResolvedValue(response);
    }
    click($('#submitBtn'));
    await flush();
  }

  const shown = (): string => $('#submitError').textContent;

  it('429: tells how long to wait, in minutes', async () => {
    await failWith(reply(429, { error: 'Too many requests' }, { 'Retry-After': '600' }));
    expect(shown()).toContain('10분');
    expect($('#submitError').hidden).toBe(false);
    expect($('#submitError').getAttribute('role')).toBe('alert');
    expect(g.document.activeElement).toBe($('#submitError'));
  });

  it('503 without consent text: says the receipt is not ready and to call or write', async () => {
    await failWith(reply(503, { code: 'PRIVACY_CONSENT_NOT_CONFIGURED' }));
    expect(shown()).toContain('준비하고 있어요');
    expect(shown()).toContain('전화나 이메일');
  });

  it('500: says to try again later and that the input is kept', async () => {
    await failWith(reply(500, { error: 'Internal', stack: 'at secret/path.ts:1' }));
    expect(shown()).toContain('입력하신 내용은 그대로 남아 있으니');
    expect(shown()).not.toContain('secret/path');
  });

  it('network error: says to check the connection and that it may have been received', async () => {
    await failWith(new TypeError('Failed to fetch'));
    expect(shown()).toContain('인터넷 연결을 확인');
    expect(shown()).toContain('이미 접수되었을 수 있으니');
    expect(shown()).not.toContain('Failed to fetch');
    expect($('#submitBtn').disabled).toBe(false);
  });

  it('timeout: the request is aborted after the time of the config and the same message is shown', async () => {
    openAtStep3(entry);
    fillCustomer();
    fetchMock.mockImplementation((_url: string, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    click($('#submitBtn'));
    await flush();
    expect($('#submitBtn').disabled).toBe(true);
    jest.advanceTimersByTime(59999);
    await flush();
    expect($('#submitError').hidden).toBe(true);
    jest.advanceTimersByTime(1);
    await flush();
    expect(shown()).toContain('인터넷 연결을 확인');
    expect($('#submitBtn').disabled).toBe(false);
    expect($('#customerName').value).toBe('Kim Minsu');
  });

  it('400 on a customer field: shows it at the field of step 3', async () => {
    await failWith(reply(400, { error: 'Validation failed', details: [{ field: 'customer_email', message: 'customer_email must be a valid email address' }] }));
    expect($('#customerEmailError').hidden).toBe(false);
    expect($('#customerErrorSummary').hidden).toBe(false);
    expect(g.document.activeElement).toBe($('#customerEmail'));
    expect($('#customerEmail').value).toBe('buyer@example.com');
    expect($('#submitBtn').disabled).toBe(false);
  });

  it('400 on something else: shows a general message and keeps the input', async () => {
    await failWith(reply(400, { error: 'Validation failed', details: ['specification_json is wrong'] }));
    expect($('#submitError').hidden).toBe(false);
    expect(shown()).not.toContain('specification_json');
    expect($('#customerName').value).toBe('Kim Minsu');
  });

  it('an answer that is not understood: a general message, no details of the answer', async () => {
    await failWith(reply(418, { token: 'SECRET-418' }));
    expect(shown()).toContain('요청을 처리하지 못했어요');
    expect(g.document.documentElement.outerHTML).not.toContain('SECRET-418');
  });

  it('a 201 without a receipt number is not shown as a success', async () => {
    await failWith(reply(201, { created_at: '2026-10-15T00:00:00Z' }));
    expect($('#successMessage').style.display).toBe('none');
    expect($('#submitError').hidden).toBe(false);
  });

  it('clears the error of the last try when it is sent again', async () => {
    await failWith(reply(500, {}));
    expect($('#submitError').hidden).toBe(false);
    fetchMock.mockReturnValue(new Promise(() => undefined));
    click($('#submitBtn'));
    await flush();
    expect($('#submitError').hidden).toBe(true);
  });
});

describe('estimate submit: text from the answer is only text', () => {
  const entry = PAGES[2];

  it('shows a receipt number and a message that look like markup as plain text', async () => {
    openAtStep3(entry);
    fillCustomer();
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    fetchMock.mockResolvedValue(reply(201, { receipt_id: attack, created_at: attack, message: attack }));
    click($('#submitBtn'));
    await flush();
    expect($('#receiptId').textContent).toBe(attack);
    expect($('#receiptMessage').textContent).toBe(attack);
    expect($('#receiptTime').textContent).toBe(attack); // a time that cannot be read is shown as it is, as text
    expect($('#successMessage img')).toBeNull();
    expect($('#successMessage script')).toBeNull();
    expect($$('#successMessage *').length).toBe(9);
  });

  it('leaves out the time and the message when the answer has none', async () => {
    openAtStep3(entry);
    fillCustomer();
    fetchMock.mockResolvedValue(reply(201, { receipt_id: 'BP-1' }));
    click($('#submitBtn'));
    await flush();
    expect($('#receiptId').textContent).toBe('BP-1');
    expect($('#receiptTimeRow').hidden).toBe(true);
    expect($('#receiptMessage').hidden).toBe(true);
    expect($('#receiptMessage').textContent).toBe('');
  });
});

describe('estimate submit: the product input is checked again', () => {
  it('goes back to step 2 and sends nothing when a value was made wrong after step 2', async () => {
    const entry = PAGES[0];
    openAtStep3(entry);
    fillCustomer();
    type($('#quantity'), '0');
    click($('#submitBtn'));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#step2-content').classList.contains('active')).toBe(true);
    expect($('#quantity').getAttribute('aria-invalid')).toBe('true');
    expect($('#submitBtn').disabled).toBe(false);
  });
});
