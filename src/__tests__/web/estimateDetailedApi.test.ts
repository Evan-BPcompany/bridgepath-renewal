/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../../estimate-api.js');

const g = globalThis as any;
afterAll(() => {
  delete g.BridgePathEstimate;
});

const customer = { customer_type: 'business_brand', customer_name: 'Kim', company_name: 'Acme', customer_email: 'buyer@example.com' };
const spec = api.buildSpecification('golf', 'golf_tee', { material: 'wood', quantity: '1000' }).spec;
const options = (extra: Record<string, unknown> = {}) => ({
  apiBase: 'http://localhost:4000',
  page: 'golf',
  subtype: 'golf_tee',
  spec,
  customer,
  consentVersion: 'dev-draft',
  files: [],
  ...extra
});

describe('buildRequest for a detailed quote request', () => {
  it('a simple request is as it was: no kind, no cookie', () => {
    for (const requestKind of [undefined, 'simple', 'premium', null]) {
      const { init } = api.buildRequest(options({ requestKind }));

      expect(init.credentials).toBe('omit');
      expect(JSON.parse(init.body)).not.toHaveProperty('request_kind');
    }
  });

  it('a detailed request in JSON names its kind and sends the session cookie', () => {
    const { init } = api.buildRequest(options({ requestKind: 'detailed' }));

    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body).request_kind).toBe('detailed');
  });

  it('a detailed request with files is a form with the kind as a field, and the cookie', () => {
    const logo = new g.File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });

    const { init } = api.buildRequest(options({ requestKind: 'detailed', files: [logo] }));

    expect(init.body.get('request_kind')).toBe('detailed');
    expect(init.credentials).toBe('include');
  });
});

describe('the answer to a detailed request', () => {
  it('knows that a sign-in is needed, and says so without a token or a server text', () => {
    const result = api.interpretResponse({ status: 401, body: { code: 'CUSTOMER_AUTH_REQUIRED', error: 'secret detail' } });

    expect(result).toEqual({ kind: 'authRequired' });
    expect(api.messageForResult(result)).toContain('로그인이 필요해요');
    expect(api.messageForResult(result)).not.toContain('secret');
  });

  it('does not take any other 401 for it', () => {
    expect(api.interpretResponse({ status: 401, body: { code: 'OTHER' } }).kind).toBe('unexpected');
    expect(api.interpretResponse({ status: 401, body: undefined }).kind).toBe('unexpected');
  });
});
