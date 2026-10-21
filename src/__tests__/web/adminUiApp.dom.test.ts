/**
 * @jest-environment jsdom
 */
import { loadPage, LoadedPage } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(g.document.querySelectorAll(selector));
const section = (id: string): any => $(`section[aria-labelledby="${id}"]`);

const SCRIPTS = ['admin-ui/admin-labels.js', 'admin-ui/admin-api.js', 'admin-ui/admin-app.js'];

// The admin screen in jsdom against a fake of the admin API: what it asks, and what it shows.

type Req = { method: string; path: string; query: Record<string, string>; body: any };
type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

const ID = '00000000-0000-4000-8000-000000000001';
const ADMIN = { id: 'u1', username: 'master', email: 'a@b.co', role: 'admin', must_change_password: false };

const item = (over: Record<string, unknown> = {}) => ({
  id: ID, receipt_id: 'BP20261021001', category: 'eyewear', status: 'new_receipt', company_name: 'Acme', customer_name: 'Kim',
  customer_type: 'business_brand', created_at: '2026-10-21T03:00:00.000Z', updated_at: '2026-10-21T03:00:00.000Z', file_count: 1, ...over
});

const detail = (over: Record<string, unknown> = {}, estimate: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    estimate: {
      id: ID, receipt_id: 'BP20261021001', category: 'eyewear', status: 'new_receipt', customer_name: 'Kim', customer_email: 'k@example.com',
      customer_phone: null, company_name: 'Acme', customer_type: 'business_brand', privacy_consent_at: '2026-10-21T03:00:00.000Z',
      privacy_consent_version: 'dev-draft', is_consultation: false, created_at: '2026-10-21T03:00:00.000Z', updated_at: '2026-10-21T03:00:00.000Z',
      specification_json: { schema_version: '1.0', frame_type: 'sunglasses', material: 'acetate', lens_type: 'gradient', quantity: 500, additional_info: 'line one\nline <b>two</b>' },
      ...estimate
    },
    files: [{ id: 'f1', filename: '<img src=x onerror=alert(1)>.png', file_size: 2457600, mime_type: 'image/png', file_status: 'quarantine', virus_scan_status: 'pending', uploaded_at: '2026-10-21T03:00:00.000Z', downloadable: false }],
    status_history: [{ id: 'h1', old_status: 'rejected', new_status: 'cancelled', changed_by: { id: 'u1', username: 'master' }, reason: 'asked <b>by customer</b>', created_at: '2026-10-21T03:00:00.000Z', retired_status: true }],
    memos: [{ id: 'm1', content: 'called\n<script>alert(1)</script>', author: { id: 'u1', username: 'master' }, created_at: '2026-10-21T04:00:00.000Z' }],
    allowed_transitions: [{ to: 'under_review', reason_required: false }, { to: 'cancelled', reason_required: true }],
    ...over
  }
});

const AI_PREVIEW = {
  source: 'customer_screen',
  analysis: {
    frame_material: 'acetate', lens_type: 'gradient', confidence: 'medium', complexity: 'high', frame_shape: '스퀘어', frame_color: '블랙',
    overview: '클래식 선글라스', details: { frame: '두꺼운 프레임', lens: '틴트', decoration: '핀' }, cost_factors: ['가공'], recommendations: ['사출로 변경']
  },
  price: { currency: 'KRW', quantity: 500, unit_price: { min: 8300, max: 11300 }, total_price: { min: 4150000, max: 5650000 } }
};

let loaded: LoadedPage | undefined;
let calls: Req[];
let routes: Record<string, (req: Req) => Answer | Promise<Answer>>;

function respond(answer: Answer): any {
  return { status: answer.status, headers: { get: (name: string) => answer.headers?.[name] ?? null }, json: async () => answer.body };
}

function fakeFetch(): jest.Mock {
  return jest.fn(async (url: string, init: any) => {
    const [path, queryText = ''] = String(url).split('?');
    const query: Record<string, string> = {};
    new URLSearchParams(queryText).forEach((value, key) => { query[key] = value; });
    const req: Req = { method: init.method, path, query, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    const pattern = Object.keys(routes).find(key => {
      const [method, route] = key.split(' ');
      return method === req.method && (route === path || (route.endsWith('*') && path.startsWith(route.slice(0, -1))));
    });
    return respond(pattern ? await routes[pattern](req) : { status: 404, body: { error: 'no route', code: 'NO_ROUTE' } });
  });
}

const settle = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

function submit(form: any): void {
  form.dispatchEvent(new g.Event('submit', { bubbles: true, cancelable: true }));
}
function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('input', { bubbles: true }));
}
function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new g.Event('change', { bubbles: true }));
}

async function open(hash = ''): Promise<void> {
  // A browser that opens an address fires no hashchange for it; jsdom does for the one set here,
  // so it is let through before the screen is loaded.
  g.location.hash = hash;
  await settle(2);
  loaded = loadPage('admin-ui/index.html', SCRIPTS);
  await settle();
}

const callsTo = (method: string, path: string): Req[] => calls.filter(call => call.method === method && call.path === path);
const signedIn = (user: Record<string, unknown> = ADMIN): void => {
  routes['GET /admin/me'] = () => ({ status: 200, body: { success: true, data: user } });
};

beforeEach(() => {
  calls = [];
  routes = {
    'POST /admin/token/refresh': () => ({ status: 401, body: { error: 'No refresh token provided' } }),
    'GET /admin/me': () => ({ status: 401, body: { error: 'No access token provided' } }),
    'GET /admin/estimates': () => ({ status: 200, body: { success: true, data: [item()], pagination: { page: 1, limit: 20, total: 1, total_pages: 1 } } }),
    [`GET /admin/estimates/${ID}`]: () => ({ status: 200, body: detail() })
  };
  g.fetch = fakeFetch();
  g.scrollTo = jest.fn();
});

afterEach(() => {
  g.AdminApp?.instance?.dispose();
  loaded?.dispose();
  loaded = undefined;
  delete g.fetch;
  delete g.AdminApp;
  delete g.AdminApi;
  delete g.AdminLabels;
  g.location.hash = '';
});

describe('the first visit and the login', () => {
  it('shows the login form, asks nothing else, and does not say that a session ended', async () => {
    await open();

    expect($('#screenTitle').textContent).toBe('로그인');
    expect($('#loginForm')).not.toBeNull();
    expect(g.location.hash).toBe('#/login');
    expect($('#notice').hidden).toBe(true);
    expect($('#whoBox').hidden).toBe(true);
    expect(callsTo('GET', '/admin/estimates')).toHaveLength(0);
  });

  it('opens the list at once when there is a session already (a reload)', async () => {
    signedIn();
    await open();

    expect($('#screenTitle').textContent).toBe('견적 접수 목록');
    expect($('#whoName').textContent).toBe('master (관리자)');
    expect($('#whoBox').hidden).toBe(false);
  });

  it('says so for a wrong password, empties the password and sends nothing but the login', async () => {
    routes['POST /admin/login'] = () => ({ status: 401, body: { error: 'Invalid credentials' } });
    await open();
    type($('#loginUser'), 'master');
    type($('#loginPassword'), 'nope');

    submit($('#loginForm'));
    await settle();

    expect($('#loginForm .error').textContent).toBe('아이디 또는 비밀번호가 맞지 않아요.');
    expect($('#loginForm .error').hidden).toBe(false);
    expect($('#loginPassword').value).toBe('');
    expect(callsTo('POST', '/admin/token/refresh')).toHaveLength(1); // only the first look for a session
  });

  it('asks for both fields before it sends anything', async () => {
    await open();

    submit($('#loginForm'));
    await settle();

    expect(callsTo('POST', '/admin/login')).toHaveLength(0);
    expect($('#loginForm .error').textContent).toContain('입력해 주세요');
  });

  it('signs in, shows who, and opens the list', async () => {
    routes['POST /admin/login'] = () => ({ status: 200, body: { message: 'Login successful', admin: ADMIN } });
    await open();
    type($('#loginUser'), ' master ');
    type($('#loginPassword'), 'Correct-Horse-9');

    submit($('#loginForm'));
    await settle();

    expect(callsTo('POST', '/admin/login')[0].body).toEqual({ username: 'master', password: 'Correct-Horse-9' });
    expect(g.location.hash).toBe('#/estimates');
    expect($('#screenTitle').textContent).toBe('견적 접수 목록');
    expect($('#whoName').textContent).toBe('master (관리자)');
    expect(g.document.body.textContent).not.toContain('Correct-Horse-9');
  });

  it('shows the role of a manager', async () => {
    signedIn({ ...ADMIN, username: 'staff', role: 'manager' });
    await open();

    expect($('#whoName').textContent).toBe('staff (담당자)');
  });

  it('signs out: asks the server, forgets who it was and shows the login', async () => {
    signedIn();
    routes['POST /admin/logout'] = () => ({ status: 200, body: { message: 'Logout successful' } });
    await open();

    $('#logoutBtn').click();
    await settle();

    expect(callsTo('POST', '/admin/logout')).toHaveLength(1);
    expect($('#loginForm')).not.toBeNull();
    expect($('#whoBox').hidden).toBe(true);
    expect($('#notice').textContent).toBe('로그아웃했어요.');
  });
});

describe('the change of the password', () => {
  const forced = { ...ADMIN, must_change_password: true };

  it('sends an account that must change it there, from the first screen and from any other', async () => {
    signedIn(forced);
    await open('#/estimates');

    expect($('#screenTitle').textContent).toBe('비밀번호를 바꿔 주세요');
    expect($('#passwordForm')).not.toBeNull();
    expect(callsTo('GET', '/admin/estimates')).toHaveLength(0);
  });

  it('after a login too', async () => {
    routes['POST /admin/login'] = () => ({ status: 200, body: { message: 'ok', admin: forced } });
    await open();
    type($('#loginUser'), 'master');
    type($('#loginPassword'), 'CHANGE_ME_ON_FIRST_LOGIN');

    submit($('#loginForm'));
    await settle();

    expect(g.location.hash).toBe('#/password');
    expect($('#pwNew')).not.toBeNull();
  });

  it('does not send two different new passwords', async () => {
    signedIn(forced);
    await open();
    type($('#pwCurrent'), 'old');
    type($('#pwNew'), 'Another-Passw0rd!');
    type($('#pwAgain'), 'Another-Passw0rd?');

    submit($('#passwordForm'));
    await settle();

    expect($('#passwordForm .error').textContent).toBe('새 비밀번호와 확인이 달라요.');
    expect(callsTo('PATCH', '/admin/me/password')).toHaveLength(0);
  });

  it('shows what the policy says is wrong, one line each', async () => {
    signedIn(forced);
    routes['PATCH /admin/me/password'] = () => ({
      status: 400, body: { error: 'x', code: 'PASSWORD_POLICY_VIOLATION', details: { violations: ['TOO_SHORT', 'NOT_ENOUGH_CHARACTER_TYPES'] } }
    });
    await open();
    type($('#pwCurrent'), 'old');
    type($('#pwNew'), 'short');
    type($('#pwAgain'), 'short');

    submit($('#passwordForm'));
    await settle();

    const lines = $$('#passwordForm .error p').map(p => p.textContent);
    expect(lines[0]).toBe('새 비밀번호가 규칙에 맞지 않아요.');
    expect(lines).toContain('12자 이상이어야 해요.');
    expect(lines).toContain('대문자·소문자·숫자·기호 중 3가지 이상을 써 주세요.');
  });

  it('says that the current password is wrong', async () => {
    signedIn(forced);
    routes['PATCH /admin/me/password'] = () => ({ status: 401, body: { error: 'x', code: 'INVALID_CURRENT_PASSWORD' } });
    await open();
    type($('#pwCurrent'), 'old');
    type($('#pwNew'), 'Another-Passw0rd!');
    type($('#pwAgain'), 'Another-Passw0rd!');

    submit($('#passwordForm'));
    await settle();

    expect($('#passwordForm .error').textContent).toBe('지금 비밀번호가 맞지 않아요.');
    expect($('#whoBox').hidden).toBe(false);
  });

  it('after a change the server has signed everything out: the login comes, with the news', async () => {
    signedIn(forced);
    routes['PATCH /admin/me/password'] = () => ({ status: 200, body: { success: true, data: { reauthentication_required: true } } });
    await open();
    type($('#pwCurrent'), 'old');
    type($('#pwNew'), 'Another-Passw0rd!');
    type($('#pwAgain'), 'Another-Passw0rd!');

    submit($('#passwordForm'));
    await settle();

    expect(callsTo('PATCH', '/admin/me/password')[0].body).toEqual({ current_password: 'old', new_password: 'Another-Passw0rd!' });
    expect($('#loginForm')).not.toBeNull();
    expect($('#notice').textContent).toBe('비밀번호를 바꿨어요. 새 비밀번호로 다시 로그인해 주세요.');
    expect($('#whoBox').hidden).toBe(true);
    expect(g.document.body.textContent).not.toContain('Another-Passw0rd!');
  });

  it('is asked for by the server in the middle of a visit (403 PASSWORD_CHANGE_REQUIRED)', async () => {
    signedIn();
    routes['GET /admin/estimates'] = () => ({ status: 403, body: { error: 'x', code: 'PASSWORD_CHANGE_REQUIRED' } });
    await open();

    expect(g.location.hash).toBe('#/password');
    expect($('#notice').textContent).toBe('먼저 비밀번호를 바꿔 주세요.');
  });
});

describe('the list', () => {
  beforeEach(() => signedIn());

  it('asks for the first page, newest first, 20 at a time', async () => {
    await open();

    expect(callsTo('GET', '/admin/estimates')[0].query).toEqual({ page: '1', limit: '20', sort: 'created_at', order: 'desc' });
  });

  it('shows a row per request: number with its link, Korean time, status, kind, customer, company, type, files', async () => {
    await open();

    const cells = $$('table.list tbody tr td').map(td => td.textContent);
    expect(cells).toEqual(['BP20261021001', '2026-10-21 12:00', '신규 접수', '선글라스·안경', 'Kim', 'Acme', '사업자·브랜드 운영 중', '1']);
    expect($('table.list tbody a').getAttribute('href')).toBe(`#/estimates/${ID}`);
    expect($('table.list .badge').className).toContain('badge-new');
    expect($('#pageInfo').textContent).toBe('1 / 1 쪽 · 총 1건');
  });

  it('writes a dash for what is missing, also the customer type of a request from before it was asked', async () => {
    routes['GET /admin/estimates'] = () => ({
      status: 200, body: { success: true, data: [item({ company_name: null, customer_name: null, customer_type: null, file_count: 0 })], pagination: { page: 1, total: 1, total_pages: 1 } }
    });
    await open();

    const cells = $$('table.list tbody tr td').map(td => td.textContent);
    expect(cells.slice(4)).toEqual(['-', '-', '-', '0']);
  });

  it('marks a request for a detailed quote in the list, and a simple one (or one from before the kind existed) not', async () => {
    routes['GET /admin/estimates'] = () => ({
      status: 200,
      body: {
        success: true,
        data: [item({ id: 'a', receipt_id: 'BP1', request_kind: 'detailed' }), item({ id: 'b', receipt_id: 'BP2', request_kind: 'simple' }), item({ id: 'c', receipt_id: 'BP3' })],
        pagination: { page: 1, total: 3, total_pages: 1 }
      }
    });
    await open();

    const first = $$('table.list tbody tr').map(row => row.querySelector('td').textContent);
    expect(first).toEqual(['BP1상세견적', 'BP2', 'BP3']);
    expect($$('table.list .tag-detailed')).toHaveLength(1);
    // Only a link to the request carries its number.
    expect($('table.list tbody a').textContent).toBe('BP1');
  });

  it('says in the detail how the request was sent and whether the customer has an account', async () => {
    routes[`GET /admin/estimates/${ID}`] = () => ({ status: 200, body: detail({}, { request_kind: 'detailed', has_account: true }) });
    await open(`#/estimates/${ID}`);
    expect(section('secCustomer').textContent).toContain('요청 종류담당자 상세견적 요청 · 회원 계정');
  });

  it('says "simple" and "no account" for a request from before the kind existed', async () => {
    await open(`#/estimates/${ID}`);
    expect(section('secCustomer').textContent).toContain('요청 종류간단 접수 · 비회원');
  });

  it('puts what a customer wrote in the table as text only', async () => {
    routes['GET /admin/estimates'] = () => ({
      status: 200, body: { success: true, data: [item({ customer_name: '<img src=x onerror=alert(1)>', company_name: '<script>alert(2)</script>' })], pagination: { page: 1, total: 1, total_pages: 1 } }
    });
    await open();

    expect($('table.list tbody').textContent).toContain('<img src=x onerror=alert(1)>');
    expect($('table.list img')).toBeNull();
    expect($('table.list script')).toBeNull();
  });

  it('says that nothing matches', async () => {
    routes['GET /admin/estimates'] = () => ({ status: 200, body: { success: true, data: [], pagination: { page: 1, total: 0, total_pages: 0 } } });
    await open();

    expect($('#listResult .empty').textContent).toBe('조건에 맞는 접수가 없어요.');
    expect($('table.list')).toBeNull();
  });

  it('says what went wrong, and keeps the filters', async () => {
    routes['GET /admin/estimates'] = () => ({ status: 500, body: { error: 'x' } });
    await open();

    expect($('#listResult .error').textContent).toContain('서버에 문제가 생겼어요');
    expect($('#filterForm')).not.toBeNull();
  });

  it('searches: the filters go into the address and into the request', async () => {
    await open();
    choose($('#fStatus'), 'quoted');
    choose($('#fCategory'), 'shoes');
    type($('#fSearch'), ' 김 ');
    type($('#fFrom'), '2026-10-01');
    type($('#fTo'), '2026-10-21');
    choose($('#fSort'), 'created_at:asc');

    submit($('#filterForm'));
    await settle();

    const last = callsTo('GET', '/admin/estimates').pop()!;
    expect(last.query).toEqual({
      page: '1', limit: '20', status: 'quoted', category: 'shoes', q: '김', created_from: '2026-10-01', created_to: '2026-10-21', sort: 'created_at', order: 'asc'
    });
    expect(g.location.hash).toContain('status=quoted');
    expect(g.location.hash).toContain('q=%EA%B9%80');
    // The filters are on the screen again, from the address.
    expect($('#fStatus').value).toBe('quoted');
    expect($('#fSearch').value).toBe('김');
  });

  it('opens a filtered list from an address, and ignores what is not a filter', async () => {
    await open('#/estimates?status=quoted&category=cars&from=yesterday&sort_key=drop%20table&page=abc&q=%20x%20');

    expect(callsTo('GET', '/admin/estimates').pop()!.query).toEqual({ page: '1', limit: '20', status: 'quoted', q: 'x', sort: 'created_at', order: 'desc' });
  });

  it('moves between pages, and the buttons say where the ends are', async () => {
    routes['GET /admin/estimates'] = req => ({
      status: 200, body: { success: true, data: [item()], pagination: { page: Number(req.query.page), limit: 20, total: 45, total_pages: 3 } }
    });
    await open();
    expect($('#pagePrev').disabled).toBe(true);
    expect($('#pageNext').disabled).toBe(false);

    $('#pageNext').click();
    await settle();
    expect(callsTo('GET', '/admin/estimates').pop()!.query.page).toBe('2');
    expect($('#pageInfo').textContent).toBe('2 / 3 쪽 · 총 45건');

    $('#pageNext').click();
    await settle();
    expect($('#pageNext').disabled).toBe(true);

    $('#pagePrev').click();
    await settle();
    expect(callsTo('GET', '/admin/estimates').pop()!.query.page).toBe('2');
  });

  it('starts again from page 1 when the filter changes', async () => {
    routes['GET /admin/estimates'] = req => ({
      status: 200, body: { success: true, data: [item()], pagination: { page: Number(req.query.page), limit: 20, total: 45, total_pages: 3 } }
    });
    await open('#/estimates?page=3');
    choose($('#fStatus'), 'quoted');

    submit($('#filterForm'));
    await settle();

    expect(callsTo('GET', '/admin/estimates').pop()!.query.page).toBe('1');
  });

  it('resets the filters', async () => {
    await open('#/estimates?status=quoted&q=kim');

    $('#filterReset').click();
    await settle();

    expect(g.location.hash).toBe('#/estimates');
    expect($('#fStatus').value).toBe('');
    expect($('#fSearch').value).toBe('');
  });
});

describe('one request', () => {
  beforeEach(() => signedIn());

  it('shows the customer, the consent, the specification in Korean, the files, the history and the memos', async () => {
    await open(`#/estimates/${ID}`);

    expect($('#screenTitle').textContent).toBe('접수 BP20261021001');
    expect($$('#detailBody h3').map(h => h.textContent)).toEqual([
      '고객 정보', '제품 사양', '첨부 파일 (1)', '상태 변경', '상태 이력', '내부 메모 (1)'
    ]);
    const customer = section('secCustomer').textContent;
    expect(customer).toContain('Kim');
    expect(customer).toContain('k@example.com');
    expect(customer).toContain('사업자·브랜드 운영 중');
    expect(customer).toContain('2026-10-21 12:00 · 안내문 dev-draft');
    const spec = section('secSpec').textContent;
    expect(spec).toContain('제품 종류선글라스');
    expect(spec).toContain('재질아세테이트');
    expect(spec).toContain('렌즈 타입그래디언트 렌즈');
    expect(spec).toContain('수량500개');
    expect($('details.raw pre').textContent).toContain('"frame_type": "sunglasses"');
    expect($('#detailBody .summary .badge').textContent).toBe('신규 접수');
  });

  it('puts everything a customer or a colleague wrote in as text: the name of a file, a memo, a reason, the specification', async () => {
    await open(`#/estimates/${ID}`);

    const body = $('#detailBody');
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    expect(section('secFiles').textContent).toContain('<img src=x onerror=alert(1)>.png');
    expect(section('secMemos').textContent).toContain('<script>alert(1)</script>');
    expect(section('secHistory').textContent).toContain('asked <b>by customer</b>');
    expect(section('secSpec').textContent).toContain('line <b>two</b>');
    // Line breaks of a memo and of a request are kept.
    expect($('.memos .long').className).toContain('long');
    expect(section('secSpec').querySelector('dd.long')).not.toBeNull();
  });

  it('says that a request from before the consent was recorded has none', async () => {
    routes[`GET /admin/estimates/${ID}`] = () => ({
      status: 200, body: detail({}, { customer_type: null, privacy_consent_at: null, privacy_consent_version: null })
    });
    await open(`#/estimates/${ID}`);

    const customer = section('secCustomer').textContent;
    expect(customer).toContain('확인 불가 (기록 이전 접수)');
    expect(customer).toContain('기록 없음');
  });

  it('shows the file with its state and says why it cannot be opened', async () => {
    await open(`#/estimates/${ID}`);

    const files = section('secFiles');
    expect(files.textContent).toContain('2.3MB');
    expect(files.textContent).toContain('격리 (검사 전)');
    expect(files.textContent).toContain('바이러스 검사 검사 전');
    expect(files.textContent).toContain('열람은 바이러스 검사를 도입하기 전이라 막혀 있어요');
    expect(files.querySelector('a')).toBeNull();
  });

  it('shows an old history with the name a retired status had', async () => {
    await open(`#/estimates/${ID}`);

    expect(section('secHistory').textContent).toContain('거절 (이전 상태명) → 취소');
    expect(section('secHistory').textContent).toContain('master');
  });

  describe('the record of the customer screen (ai_preview)', () => {
    it('is shown apart, in Korean, and said not to be a quote', async () => {
      routes[`GET /admin/estimates/${ID}`] = () => ({
        status: 200, body: detail({}, { specification_json: { schema_version: '1.0', frame_type: 'sunglasses', material: 'acetate', lens_type: 'gradient', quantity: 500, ai_preview: AI_PREVIEW } })
      });
      await open(`#/estimates/${ID}`);

      const ai = section('secAi').textContent;
      expect($$('#detailBody h3').map(h => h.textContent)).toContain('고객 화면에 보인 AI 분석 (참고용)');
      expect(ai).toContain('견적이 아니고, 사실로 확인된 값도 아니에요');
      expect(ai).toContain('약 8,300원 ~ 11,300원');
      expect(ai).toContain('약 4,150,000원 ~ 5,650,000원 (500개 기준)');
      expect(ai).toContain('AI가 본 재질아세테이트');
      expect(ai).toContain('제작 복잡도높음');
      expect(ai).toContain('주요 비용 요인');
      expect(ai).toContain('사출로 변경');
      // It is not one of the rows of the specification.
      expect(section('secSpec').querySelector('dl')!.textContent).not.toContain('ai_preview');
    });

    it('is not there for a request without one', async () => {
      await open(`#/estimates/${ID}`);

      expect(section('secAi')).toBeNull();
    });
  });

  it('says that a request is not there', async () => {
    routes[`GET /admin/estimates/${ID}`] = () => ({ status: 404, body: { error: 'x', code: 'ESTIMATE_NOT_FOUND' } });
    await open(`#/estimates/${ID}`);

    expect($('#detailBody .error').textContent).toBe('접수를 찾을 수 없어요.');
    expect($('a.back').getAttribute('href')).toBe('#/estimates');
  });

  it('goes back to the list', async () => {
    await open(`#/estimates/${ID}`);

    g.location.hash = '#/estimates';
    await settle();

    expect($('#screenTitle').textContent).toBe('견적 접수 목록');
  });

  describe('the change of the status', () => {
    it('offers only what the server allows, with a mark where a reason is needed', async () => {
      await open(`#/estimates/${ID}`);

      expect($$('#statusTarget option').map(o => o.textContent)).toEqual(['정보 확인 중', '취소 (사유 필요)']);
      expect($('#statusReasonHint').textContent).toContain('사유는 선택');
      choose($('#statusTarget'), 'cancelled');
      expect($('#statusReasonHint').textContent).toContain('꼭 필요해요');
    });

    it('says when there is no way on, instead of showing a form', async () => {
      routes[`GET /admin/estimates/${ID}`] = () => ({ status: 200, body: detail({ allowed_transitions: [] }, { status: 'completed' }) });
      await open(`#/estimates/${ID}`);

      expect($('#statusForm')).toBeNull();
      expect(section('secStatus').textContent).toContain('바꿀 수 있는 다음 상태가 없어요');
    });

    it('does not send a change that needs a reason without one', async () => {
      await open(`#/estimates/${ID}`);
      choose($('#statusTarget'), 'cancelled');
      type($('#statusReason'), '   ');

      submit($('#statusForm'));
      await settle();

      expect(callsTo('PATCH', `/admin/estimates/${ID}/status`)).toHaveLength(0);
      expect($('#statusForm .error').textContent).toBe('이 상태로 바꾸려면 사유를 적어 주세요.');
    });

    it('sends the change with the status that was on the screen, so that a change by a colleague is noticed', async () => {
      routes[`PATCH /admin/estimates/${ID}/status`] = () => ({ status: 200, body: { success: true, data: { status: 'under_review' } } });
      await open(`#/estimates/${ID}`);
      choose($('#statusTarget'), 'under_review');

      submit($('#statusForm'));
      await settle();

      expect(callsTo('PATCH', `/admin/estimates/${ID}/status`)[0].body).toEqual({ to_status: 'under_review', expected_status: 'new_receipt' });
    });

    it('sends the reason, trimmed, and shows the result: a message, and the request again from the server', async () => {
      routes[`PATCH /admin/estimates/${ID}/status`] = () => ({ status: 200, body: { success: true, data: { status: 'cancelled' } } });
      await open(`#/estimates/${ID}`);
      choose($('#statusTarget'), 'cancelled');
      type($('#statusReason'), '  customer cancelled  ');

      submit($('#statusForm'));
      await settle();

      expect(callsTo('PATCH', `/admin/estimates/${ID}/status`)[0].body).toEqual({
        to_status: 'cancelled', reason: 'customer cancelled', expected_status: 'new_receipt'
      });
      expect($('#notice').textContent).toBe('상태를 "취소"(으)로 바꿨어요.');
      expect(callsTo('GET', `/admin/estimates/${ID}`)).toHaveLength(2);
    });

    it('shows a new state from the server after a change', async () => {
      let status = 'new_receipt';
      routes[`GET /admin/estimates/${ID}`] = () => ({ status: 200, body: detail({}, { status }) });
      routes[`PATCH /admin/estimates/${ID}/status`] = () => {
        status = 'under_review';
        return { status: 200, body: { success: true, data: {} } };
      };
      await open(`#/estimates/${ID}`);

      submit($('#statusForm'));
      await settle();

      expect($('#detailBody .summary .badge').textContent).toBe('정보 확인 중');
    });

    it('tells that a colleague changed it first, and shows what it is now', async () => {
      let status = 'new_receipt';
      routes[`GET /admin/estimates/${ID}`] = () => ({ status: 200, body: detail({}, { status }) });
      routes[`PATCH /admin/estimates/${ID}/status`] = () => {
        status = 'quoted';
        return { status: 409, body: { error: 'x', code: 'STATUS_CONFLICT', current_status: 'quoted' } };
      };
      await open(`#/estimates/${ID}`);

      submit($('#statusForm'));
      await settle();

      expect($('#notice').textContent).toContain('다른 담당자가 먼저 상태를 바꿨어요');
      expect($('#detailBody .summary .badge').textContent).toBe('정식견적 발송');
    });

    it('says why another refusal came, and keeps the form', async () => {
      routes[`PATCH /admin/estimates/${ID}/status`] = () => ({ status: 403, body: { error: 'x', code: 'INSUFFICIENT_ROLE' } });
      await open(`#/estimates/${ID}`);
      choose($('#statusTarget'), 'cancelled');
      type($('#statusReason'), 'because');

      submit($('#statusForm'));
      await settle();

      expect($('#statusForm .error').textContent).toBe('이 상태 변경은 관리자만 할 수 있어요.');
      expect($('#statusForm button').disabled).toBe(false);
    });
  });

  describe('the memos', () => {
    it('does not send an empty memo', async () => {
      await open(`#/estimates/${ID}`);
      type($('#memoText'), '   ');

      submit($('#memoForm'));
      await settle();

      expect(callsTo('POST', `/admin/estimates/${ID}/memos`)).toHaveLength(0);
      expect($('#memoForm .error').textContent).toBe('메모 내용을 적어 주세요.');
    });

    it('sends the memo trimmed and shows the list again from the server', async () => {
      routes[`POST /admin/estimates/${ID}/memos`] = () => ({ status: 201, body: { success: true, data: {} } });
      await open(`#/estimates/${ID}`);
      type($('#memoText'), '  new note  ');

      submit($('#memoForm'));
      await settle();

      expect(callsTo('POST', `/admin/estimates/${ID}/memos`)[0].body).toEqual({ content: 'new note' });
      expect($('#notice').textContent).toBe('메모를 남겼어요.');
      expect(callsTo('GET', `/admin/estimates/${ID}`)).toHaveLength(2);
    });

    it('says what went wrong and keeps the text', async () => {
      routes[`POST /admin/estimates/${ID}/memos`] = () => ({ status: 400, body: { error: 'x', code: 'MEMO_TOO_LONG' } });
      await open(`#/estimates/${ID}`);
      type($('#memoText'), 'long');

      submit($('#memoForm'));
      await settle();

      expect($('#memoForm .error').textContent).toBe('메모는 5,000자까지 쓸 수 있어요.');
      expect($('#memoText').value).toBe('long');
    });

    it('limits the text to what the API takes', async () => {
      await open(`#/estimates/${ID}`);

      expect($('#memoText').getAttribute('maxlength')).toBe('5000');
      expect($('#statusReason').getAttribute('maxlength')).toBe('1000');
    });
  });
});

describe('a session that ends in the middle of a visit', () => {
  it('shows the login with the news, and forgets who it was', async () => {
    signedIn();
    await open();
    routes['GET /admin/estimates'] = () => ({ status: 401, body: { error: 'Invalid or expired access token' } });

    g.location.hash = '#/estimates?status=quoted';
    await settle();

    expect($('#loginForm')).not.toBeNull();
    expect($('#notice').textContent).toBe('로그인이 끝났어요. 다시 로그인해 주세요.');
    expect($('#whoBox').hidden).toBe(true);
  });

  it('carries on without a word when the refresh of the session works', async () => {
    signedIn();
    let expired = true;
    routes['GET /admin/estimates'] = () => (expired
      ? { status: 401, body: { error: 'expired' } }
      : { status: 200, body: { success: true, data: [item()], pagination: { page: 1, total: 1, total_pages: 1 } } });
    routes['POST /admin/token/refresh'] = () => {
      expired = false;
      return { status: 200, body: { message: 'Token refreshed successfully' } };
    };
    await open();

    expect($('table.list')).not.toBeNull();
    expect($('#notice').hidden).toBe(true);
  });
});

describe('the addresses', () => {
  it('sends someone who is not signed in to the login from any address', async () => {
    await open(`#/estimates/${ID}`);

    expect($('#loginForm')).not.toBeNull();
    expect(callsTo('GET', `/admin/estimates/${ID}`)).toHaveLength(0);
  });

  it('opens the list for an address it does not know', async () => {
    signedIn();
    await open('#/nothing/here');

    expect($('#screenTitle').textContent).toBe('견적 접수 목록');
  });

  it('shows the login even to someone who is signed in when the address asks for it', async () => {
    signedIn();
    await open('#/login');

    expect($('#loginForm')).not.toBeNull();
  });

  it('does not draw a screen that was replaced before its answer came', async () => {
    signedIn();
    let releaseList: (answer: Answer) => void = () => undefined;
    routes['GET /admin/estimates'] = () => new Promise<Answer>(resolve => { releaseList = resolve; });
    await open();
    expect($('#listResult').textContent).toContain('불러오는 중');

    g.location.hash = `#/estimates/${ID}`;
    await settle();
    releaseList({ status: 200, body: { success: true, data: [item()], pagination: { page: 1, total: 1, total_pages: 1 } } });
    await settle();

    expect($('#screenTitle').textContent).toBe('접수 BP20261021001');
    // The list that answered late is not drawn over the request (the tables of the request stay).
    expect($('#listResult')).toBeNull();
    expect($('#filterForm')).toBeNull();
  });
});

describe('the parts of the address', () => {
  it('reads and writes the query of a list', () => {
    const app = g.AdminApp ?? (() => { loaded = loadPage('admin-ui/index.html', SCRIPTS); return g.AdminApp; })();

    expect(app.parseHash('#/estimates?status=quoted&q=a%20b&bad=%E0%A4%A')).toEqual({ name: 'list', query: { status: 'quoted', q: 'a b' } });
    expect(app.parseHash('#/estimates/abc-1')).toEqual({ name: 'detail', id: 'abc-1' });
    expect(app.parseHash('')).toEqual({ name: 'list', query: {} });
    expect(app.buildHash({ status: 'quoted', q: '', page: '' })).toBe('#/estimates?status=quoted');
    expect(app.buildHash({})).toBe('#/estimates');
  });
});
