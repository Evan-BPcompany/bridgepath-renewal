/* eslint-disable @typescript-eslint/no-var-requires */
import { ESTIMATE_STATUSES, RETIRED_STATUSES } from '../../utils/statusTransitions';
import { CATEGORIES } from '../../middleware/adminValidation';

// The words and the calls of the admin screen (admin-ui/admin-labels.js, admin-api.js), run in
// Node: neither touches the page.
const labels = require('../../../admin-ui/admin-labels.js');
const adminApi = require('../../../admin-ui/admin-api.js');

describe('admin-labels', () => {
  it('names every status of the backend, and every retired one an old history may still hold', () => {
    expect(Object.keys(labels.STATUS).sort()).toEqual([...ESTIMATE_STATUSES].sort());
    expect([...labels.STATUS_ORDER].sort()).toEqual([...ESTIMATE_STATUSES].sort());
    for (const retired of RETIRED_STATUSES) {
      expect(labels.statusLabel(retired)).toMatch(/\(이전 상태명\)$/);
    }
    for (const status of ESTIMATE_STATUSES) {
      expect(labels.statusTone(status)).toMatch(/^(new|work|wait|good|done|stop)$/);
    }
  });

  it('names every category of the backend', () => {
    expect(Object.keys(labels.CATEGORY).sort()).toEqual([...CATEGORIES].sort());
  });

  it('shows what it cannot name as it is, and nothing for nothing', () => {
    expect(labels.statusLabel('something_new')).toBe('something_new');
    expect(labels.statusLabel(null)).toBe('');
    expect(labels.statusLabel(undefined)).toBe('');
    expect(labels.statusTone('something_new')).toBe('stop');
    expect(labels.pick(labels.CATEGORY, 'cars', 'cars')).toBe('cars');
    // A key of Object.prototype is not a label.
    expect(labels.statusLabel('toString')).toBe('toString');
    expect(labels.statusTone('__proto__')).toBe('stop');
  });

  describe('formatDateTime: Korean time, from the ISO time of the API', () => {
    it.each([
      ['2026-10-21T03:00:00.000Z', '2026-10-21 12:00'],
      ['2026-10-20T15:30:00.000Z', '2026-10-21 00:30'],
      ['2026-10-20T15:00:00.000Z', '2026-10-21 00:00'],
      ['2026-12-31T14:59:00.000Z', '2026-12-31 23:59'],
      ['2026-12-31T15:00:00.000Z', '2027-01-01 00:00']
    ])('%s is %s', (iso, expected) => {
      expect(labels.formatDateTime(iso)).toBe(expected);
    });

    it('gives back what it cannot read, and nothing for nothing', () => {
      expect(labels.formatDateTime('not a time')).toBe('not a time');
      expect(labels.formatDateTime('')).toBe('');
      expect(labels.formatDateTime(null)).toBe('');
    });
  });

  it('formats sizes and prices', () => {
    expect(labels.formatBytes(2048)).toBe('2KB');
    expect(labels.formatBytes(10)).toBe('1KB');
    expect(labels.formatBytes(2457600)).toBe('2.3MB');
    expect(labels.formatBytes('x')).toBe('');
    expect(labels.formatBytes(-1)).toBe('');
    expect(labels.formatWon(4150000)).toBe('4,150,000원');
  });

  describe('specValue', () => {
    it('writes a quantity with its unit, and a known code by its name', () => {
      expect(labels.specValue('quantity', 1200)).toBe('1,200개');
      expect(labels.specValue('material', 'acetate')).toBe('아세테이트');
      expect(labels.specValue('lens_type', 'photochromic')).toBe('변색 렌즈');
      expect(labels.specValue('frame_type', 'kids')).toBe('키즈 안경');
      expect(labels.specValue('shoe_type', 'sandals')).toBe('샌들/슬리퍼');
      expect(labels.specValue('product_type', 'covers')).toBe('골프 커버·케이스');
    });

    it('keeps a code it does not know, joins a list and writes an object as JSON', () => {
      expect(labels.specValue('material', 'titanium')).toBe('titanium');
      expect(labels.specValue('sizes', [250, 270])).toBe('250, 270');
      expect(labels.specValue('x', { a: 1 })).toBe('{"a":1}');
    });

    it('writes nothing for an empty value', () => {
      expect(labels.specValue('color', '')).toBe('');
      expect(labels.specValue('color', null)).toBe('');
      expect(labels.specValue('color', undefined)).toBe('');
    });

    it('does not take the name of a member of Object.prototype for a code', () => {
      expect(labels.specValue('material', 'constructor')).toBe('constructor');
    });
  });
});

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers: { get: (name: string) => headers[name] ?? null },
  json: async () => {
    if (body === undefined) {
      throw new Error('no body');
    }
    return body;
  }
});

describe('admin-api', () => {
  let fetchMock: jest.Mock;
  let api: any;
  let ended: jest.Mock;
  let mustChange: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    api = adminApi.create((url: string, init: unknown) => fetchMock(url, init));
    ended = jest.fn();
    mustChange = jest.fn();
    api.onSessionEnded(ended);
    api.onPasswordChangeRequired(mustChange);
  });

  describe('what it sends', () => {
    it('keeps to the cookies: same origin, no token in a header, JSON only when there is a body', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: true, data: [] }));

      await api.list({ page: 2, status: 'quoted', q: '', category: undefined });
      await api.changeStatus('abc', { to_status: 'quoted' });

      const [listUrl, listInit] = fetchMock.mock.calls[0];
      expect(listUrl).toBe('/admin/estimates?page=2&status=quoted');
      expect(listInit).toMatchObject({ method: 'GET', credentials: 'same-origin' });
      expect(listInit.headers['Content-Type']).toBeUndefined();
      expect(listInit.body).toBeUndefined();
      const [, patchInit] = fetchMock.mock.calls[1];
      expect(patchInit.method).toBe('PATCH');
      expect(patchInit.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(patchInit.body)).toEqual({ to_status: 'quoted' });
      for (const [, init] of fetchMock.mock.calls) {
        expect(JSON.stringify(init.headers)).not.toMatch(/authorization|bearer|token/i);
      }
    });

    it('writes an id and a query value so that nothing can change the address', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: true, data: {} }));

      await api.detail('a/b?c=d');
      await api.list({ q: 'a&b=c d' });

      expect(fetchMock.mock.calls[0][0]).toBe('/admin/estimates/a%2Fb%3Fc%3Dd');
      expect(fetchMock.mock.calls[1][0]).toBe('/admin/estimates?q=a%26b%3Dc%20d');
    });

    it('sends the memo and the password change as the API reads them', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: true, data: {} }));

      await api.addMemo('id1', 'hello');
      await api.changePassword('old', 'new');
      await api.login('master', 'secret');

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content: 'hello' });
      expect(fetchMock.mock.calls[0][0]).toBe('/admin/estimates/id1/memos');
      expect(fetchMock.mock.calls[1][0]).toBe('/admin/me/password');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ current_password: 'old', new_password: 'new' });
      expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ username: 'master', password: 'secret' });
    });
  });

  describe('what it answers', () => {
    it('gives the data and the pagination of a list', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: true, data: [{ id: 1 }], pagination: { page: 1, total: 1, total_pages: 1 } }));

      expect(await api.list({})).toEqual({ ok: true, status: 200, data: [{ id: 1 }], pagination: { page: 1, total: 1, total_pages: 1 } });
    });

    it('gives the admin of a login, whose answer is { message, admin }', async () => {
      fetchMock.mockResolvedValue(reply(200, { message: 'Login successful', admin: { id: 'u', role: 'admin', must_change_password: true } }));

      expect(await api.login('a', 'b')).toEqual({ ok: true, status: 200, data: { id: 'u', role: 'admin', must_change_password: true } });
    });

    it.each([
      [401, { error: 'Invalid credentials' }, 'invalid_credentials'],
      [401, { error: 'Account is locked. Try again later.' }, 'locked'],
      [401, { error: 'Admin account is inactive' }, 'inactive']
    ])('a login refused with %i %j is %s, without any refresh of a session', async (status, body, code) => {
      fetchMock.mockResolvedValue(reply(status, body));

      const result = await api.login('a', 'b');

      expect(result).toMatchObject({ ok: false, code });
      expect(result.message).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(ended).not.toHaveBeenCalled();
    });

    it.each([
      [400, { error: 'x', code: 'VALIDATION_ERROR', details: [{ field: 'page' }] }, 'VALIDATION_ERROR'],
      [409, { error: 'x', code: 'STATUS_CONFLICT', current_status: 'quoted' }, 'STATUS_CONFLICT'],
      [422, { error: 'x', code: 'REASON_REQUIRED' }, 'REASON_REQUIRED'],
      [404, { error: 'x', code: 'ESTIMATE_NOT_FOUND' }, 'ESTIMATE_NOT_FOUND'],
      [403, { error: 'Insufficient permissions' }, 'forbidden'],
      [500, { error: 'Internal server error' }, 'server'],
      [502, undefined, 'server'],
      [418, { error: 'teapot' }, 'unexpected']
    ])('answers %i with the code %s and a text for the screen', async (status, body, code) => {
      fetchMock.mockResolvedValue(reply(status, body));

      const result = await api.detail('x');

      expect(result).toMatchObject({ ok: false, status, code });
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(3);
    });

    it('keeps what the screen needs of a refused request: the details and the status that was found', async () => {
      fetchMock.mockResolvedValue(reply(409, { error: 'x', code: 'STATUS_CONFLICT', current_status: 'quoted' }));
      expect(await api.changeStatus('x', {})).toMatchObject({ currentStatus: 'quoted' });

      fetchMock.mockResolvedValue(reply(400, { error: 'x', code: 'PASSWORD_POLICY_VIOLATION', details: { violations: ['TOO_SHORT'] } }));
      expect((await api.changePassword('a', 'b')).details).toEqual({ violations: ['TOO_SHORT'] });
    });

    it('reads the wait of a 429 from the header', async () => {
      fetchMock.mockResolvedValue(reply(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '42' }));

      expect(await api.list({})).toMatchObject({ ok: false, code: 'rate_limited', retryAfterSeconds: 42 });
    });

    it('tells a network failure from a refusal, and never throws', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      expect(await api.list({})).toMatchObject({ ok: false, status: 0, code: 'network' });
    });

    it('tells the screen that a password change is needed, and the code of a wrong current password stays a code', async () => {
      fetchMock.mockResolvedValue(reply(403, { error: 'x', code: 'PASSWORD_CHANGE_REQUIRED' }));
      expect(await api.list({})).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      expect(mustChange).toHaveBeenCalledTimes(1);

      fetchMock.mockReset().mockResolvedValue(reply(401, { error: 'x', code: 'INVALID_CURRENT_PASSWORD' }));
      expect(await api.changePassword('a', 'b')).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
      // A coded 401 is the answer, not an expired session: no refresh was tried.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(ended).not.toHaveBeenCalled();
    });
  });

  describe('an expired session', () => {
    it('is refreshed once and the request is sent again', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(401, { error: 'Invalid or expired access token' }))
        .mockResolvedValueOnce(reply(200, { message: 'Token refreshed successfully' }))
        .mockResolvedValueOnce(reply(200, { success: true, data: [{ id: 1 }] }));

      const result = await api.list({});

      expect(result).toMatchObject({ ok: true, data: [{ id: 1 }] });
      expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/admin/estimates', '/admin/token/refresh', '/admin/estimates']);
      expect(fetchMock.mock.calls[1][1].method).toBe('POST');
      expect(ended).not.toHaveBeenCalled();
    });

    it('ends the session when the refresh is refused, once, and answers as unauthenticated', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(401, { error: 'No access token provided' }))
        .mockResolvedValueOnce(reply(401, { error: 'Invalid refresh token' }));

      const result = await api.list({});

      expect(result).toMatchObject({ ok: false, code: 'unauthenticated' });
      expect(ended).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('ends the session when the request is refused again after a refresh that worked', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(401, { error: 'x' }))
        .mockResolvedValueOnce(reply(200, {}))
        .mockResolvedValueOnce(reply(401, { error: 'Session has been revoked' }));

      const result = await api.detail('x');

      expect(result.ok).toBe(false);
      expect(ended).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('shares one refresh between requests that find the session expired together', async () => {
      let refreshes = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/admin/token/refresh') {
          refreshes += 1;
          return reply(200, {});
        }
        return refreshes === 0 ? reply(401, { error: 'expired' }) : reply(200, { success: true, data: [] });
      });

      const results = await Promise.all([api.list({}), api.detail('a'), api.list({ page: 2 })]);

      expect(results.every((result: { ok: boolean }) => result.ok)).toBe(true);
      expect(refreshes).toBe(1);
    });

    it('does not tell anybody when the call only asks whether there is a session (quiet)', async () => {
      fetchMock.mockResolvedValue(reply(401, { error: 'No access token provided' }));

      const result = await api.me();

      expect(result).toMatchObject({ ok: false, code: 'unauthenticated' });
      expect(ended).not.toHaveBeenCalled();
    });

    it('does not try to refresh a failed login or when the refresh itself fails on the network', async () => {
      fetchMock.mockResolvedValueOnce(reply(401, { error: 'x' })).mockRejectedValueOnce(new TypeError('down'));

      const result = await api.list({});

      expect(result.ok).toBe(false);
      expect(ended).toHaveBeenCalledTimes(1);
    });
  });

  it('has a text for every code it can answer with', () => {
    for (const code of Object.keys(adminApi.MESSAGES)) {
      expect(adminApi.MESSAGES[code].length).toBeGreaterThan(3);
    }
    expect(adminApi.messageFor('nothing like it')).toBe(adminApi.MESSAGES.unexpected);
    expect(adminApi.messageFor('toString')).toBe(adminApi.MESSAGES.unexpected);
  });
});
