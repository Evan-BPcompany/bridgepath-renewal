/**
 * @jest-environment jsdom
 */
import { loadPage, PAGE_SCRIPTS, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));

const type = (element: any, value: string): void => {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
};
const choose = (element: any, value: string): void => {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
};
const click = (element: any): void => {
  element.dispatchEvent(new g.MouseEvent('click', { bubbles: true, cancelable: true }));
};

const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => body });
const CUSTOMER = {
  id: 'c1', email: 'buyer@example.com', name: '김구매', phone: '010-1234-5678', company_name: 'ACME', customer_type: 'business_brand',
  consent_required: false
};

const SCRIPTS = (): string[] => {
  const scripts = PAGE_SCRIPTS('sunglasses');
  scripts.splice(1, 0, 'customer-auth.js');
  scripts.splice(scripts.length - 1, 0, 'estimate-preview.js', 'estimate-result.js');
  return scripts;
};

let loaded: LoadedPage;
let fetchMock: jest.Mock;
let signedIn: boolean;
let estimateAnswer: any;

const settle = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};
const callsTo = (fragment: string): any[] => fetchMock.mock.calls.filter(call => String(call[0]).includes(fragment));
const isActive = (selector: string): boolean => $(selector).classList.contains('active');

// The page at the result screen, as a customer who has filled the form gets there.
async function atResultScreen(): Promise<void> {
  $('.category-card[data-category="sunglasses"]').click();
  choose($('#frameMaterial'), 'plastic');
  choose($('#lensType'), 'normal');
  type($('#quantity'), '500');
  click($('#nextBtn2'));
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  signedIn = false;
  estimateAnswer = answer(201, { receipt_id: 'BP20261021001', created_at: '2026-10-21T00:00:00.000Z', message: 'ok' });
  fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/api/customers/me')) {
      return signedIn ? answer(200, { customer: CUSTOMER }) : answer(401, { code: 'CUSTOMER_AUTH_REQUIRED' });
    }
    if (url.endsWith('/api/estimate-preview')) {
      return answer(200, {
        available: true, currency: 'KRW', quantity: 500, unit_price: { min: 1, max: 2 }, total_price: { min: 3, max: 4 }, notice: 'guidance'
      });
    }
    if (url.endsWith('/api/estimates')) {
      return estimateAnswer;
    }
    return answer(404, {});
  });
  g.fetch = fetchMock;
  loaded = loadPage('sunglasses-estimate.html', SCRIPTS());
});

afterEach(() => {
  loaded.dispose();
  jest.useRealTimers();
  delete g.fetch;
  delete g.BridgePathAuth;
});

describe('the detailed quote card on the result screen', () => {
  it('offers the detailed quote, says it takes 2-3 working days at most, and that it is for signed-in customers', async () => {
    await atResultScreen();

    expect(isActive('#result-content')).toBe(true);
    const text = $('.detailed-card').textContent;
    expect(text).toContain('담당자 상세견적 받으러 가기');
    expect(text).toContain('업무일 기준 2~3일 정도 걸릴 수 있어요');
    expect(text).toContain('로그인한 고객만');
    expect($('#detailedBtn').textContent).toBe('담당자 상세견적 받으러 가기');
    expect($('#detailedLogin').hidden).toBe(true);
  });

  it('keeps the simple request next to it', async () => {
    await atResultScreen();

    expect($('#resultRequestBtn').textContent).toBe('정식 견적 요청하기');
  });
});

describe('a customer who is not signed in', () => {
  it('is asked to sign in or sign up in a new tab, and stays on the result screen with the form as it was', async () => {
    await atResultScreen();

    click($('#detailedBtn'));
    await settle();

    expect($('#detailedLogin').hidden).toBe(false);
    expect(isActive('#result-content')).toBe(true);
    expect(isActive('#step3-content')).toBe(false);
    const links = $$('#detailedLogin a');
    expect(links.map(link => link.textContent)).toEqual(['로그인', '회원가입']);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener');
      expect(link.getAttribute('href')).toMatch(/^login\.html\?(mode=signup&)?next=%2Flogin-complete\.html$/);
    }
    expect($('#quantity').value).toBe('500');
    expect(callsTo('/api/estimates')).toEqual([]);
  });

  it('goes on to the customer step by itself when the customer comes back signed in', async () => {
    await atResultScreen();
    click($('#detailedBtn'));
    await settle();

    // Back in this tab after logging in elsewhere.
    signedIn = true;
    g.window.dispatchEvent(new g.Event('focus'));
    await settle();

    expect(isActive('#step3-content')).toBe(true);
    expect($('#detailedLogin').hidden).toBe(true);
    expect($('#detailedNote').hidden).toBe(false);
  });

  it('keeps waiting while they are still not signed in, and checks again at the next return', async () => {
    await atResultScreen();
    click($('#detailedBtn'));
    await settle();

    g.window.dispatchEvent(new g.Event('focus'));
    await settle();
    expect(isActive('#step3-content')).toBe(false);
    expect($('#detailedLogin').hidden).toBe(false);

    signedIn = true;
    g.document.dispatchEvent(new g.Event('visibilitychange'));
    await settle();
    expect(isActive('#step3-content')).toBe(true);
  });

  it('asks the server nothing when the tab gets the focus and nobody is waiting', async () => {
    await atResultScreen();

    g.window.dispatchEvent(new g.Event('focus'));
    await settle();

    expect(callsTo('/api/customers/me')).toEqual([]);
  });

  it('stops waiting when they go back to change the form', async () => {
    await atResultScreen();
    click($('#detailedBtn'));
    await settle();
    click($('#resultEditBtn'));
    await settle();

    signedIn = true;
    g.window.dispatchEvent(new g.Event('focus'));
    await settle();

    expect(isActive('#step3-content')).toBe(false);
    expect(isActive('#step2-content')).toBe(true);
  });
});

describe('a signed-in customer', () => {
  beforeEach(() => {
    signedIn = true;
  });

  const start = async (): Promise<void> => {
    await atResultScreen();
    click($('#detailedBtn'));
    await settle();
  };

  it('goes straight to the customer step, which says it is a detailed quote request and is filled from the account', async () => {
    await start();

    expect(isActive('#step3-content')).toBe(true);
    expect($('#detailedNote').hidden).toBe(false);
    expect($('#detailedNote').textContent).toContain('업무일 기준 2~3일 정도 걸릴 수 있어요');
    expect($('#step3-content h2').textContent).toBe('담당자 상세견적 요청 정보를 확인해주세요');
    expect($('#customerName').value).toBe('김구매');
    expect($('#customerEmail').value).toBe('buyer@example.com');
    expect($('#customerPhone').value).toBe('010-1234-5678');
    expect($('#customerCompany').value).toBe('ACME');
    expect($('#customerTypeBusiness').checked).toBe(true);
    // The consent is the customer's to give for this request.
    expect($('#privacyConsent').checked).toBe(false);
  });

  it('sends a detailed request with the session cookie, and says on the receipt that it takes 2-3 working days at most', async () => {
    await start();
    $('#privacyConsent').checked = true;

    click($('#submitBtn'));
    await settle();

    const [url, init] = callsTo('/api/estimates')[0];
    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toMatchObject({
      request_kind: 'detailed', customer_name: '김구매', customer_email: 'buyer@example.com', company_name: 'ACME',
      customer_type: 'business_brand', category: 'eyewear'
    });
    expect($('#successMessage').style.display).toBe('block');
    expect($('#successTitle').textContent).toBe('담당자 상세견적 요청이 접수되었어요');
    expect($('#detailedSuccessNote').hidden).toBe(false);
    expect($$('#receiptSummaryList dt').map(item => item.textContent)).toContain('요청 종류');
    expect($$('#receiptSummaryList dd').map(item => item.textContent)).toContain('담당자 상세견적');
  });

  it('is told to sign in again when the session ended meanwhile, and keeps the form', async () => {
    await start();
    $('#privacyConsent').checked = true;
    estimateAnswer = answer(401, { code: 'CUSTOMER_AUTH_REQUIRED' });

    click($('#submitBtn'));
    await settle();

    expect($('#submitError').hidden).toBe(false);
    expect($('#submitError').textContent).toContain('로그인이 필요해요');
    expect($('#successMessage').style.display).toBe('none');
    expect($('#customerName').value).toBe('김구매');
    expect($('#submitBtn').disabled).toBe(false);
  });

  it('is back to a simple request, as before, when they choose "정식 견적 요청하기" instead', async () => {
    await start();
    click($$('#step3-content .btn-secondary')[0]);
    click($('#resultRequestBtn'));
    await settle();

    expect($('#detailedNote').hidden).toBe(true);
    expect($('#step3-content h2').textContent).toBe('고객 정보를 입력해주세요');
    $('#privacyConsent').checked = true;
    click($('#submitBtn'));
    await settle();

    const [, init] = callsTo('/api/estimates')[0];
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).not.toHaveProperty('request_kind');
    expect($('#successTitle').textContent).toBe('견적 요청이 접수되었어요');
    expect($('#detailedSuccessNote').hidden).toBe(true);
  });
});

describe('the page without the account script', () => {
  it('does not break: the card is there, the button does nothing', async () => {
    delete g.BridgePathAuth;
    await atResultScreen();

    click($('#detailedBtn'));
    await settle();

    expect(isActive('#step3-content')).toBe(false);
  });
});
