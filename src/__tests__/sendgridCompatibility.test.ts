import http from 'http';
import https from 'https';
import type { AddressInfo } from 'net';
import { config } from '../config/env';
import { sendEmailViaSendGrid } from '../services/emailWorker';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sgMail = require('@sendgrid/mail');

// Exercises the installed @sendgrid/mail (8.x) through our own sendEmailViaSendGrid against a
// stub HTTP server on 127.0.0.1. No request ever leaves the machine and no real SendGrid
// account or API key is involved.

interface RecordedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// Hard guard: while this file runs, any HTTP(S) request to a host other than 127.0.0.1 is
// refused and recorded, so a mistake can never reach the real SendGrid.
const blockedExternal: string[] = [];
const nativeHttpRequest = http.request;
const nativeHttpsRequest = https.request;

function blockExternal<T extends typeof http.request>(label: string, original: T): T {
  return function (this: unknown, ...args: any[]) {
    const first = args[0];
    const host =
      typeof first === 'string'
        ? new URL(first).hostname
        : first?.hostname || first?.host || args[1]?.hostname || args[1]?.host || '';
    if (host !== '127.0.0.1') {
      blockedExternal.push(`${label} ${host}`);
      throw new Error(`External request blocked in test: ${host}`);
    }
    return (original as any).apply(this, args);
  } as unknown as T;
}

describe('@sendgrid/mail 8.x compatibility (local stub server)', () => {
  const API_KEY = 'SG.test-only-not-a-real-key';
  let server: http.Server;
  let stubUrl: string;
  let requests: RecordedRequest[];
  let reply: (res: http.ServerResponse) => void;

  const originalKey = config.sendgridApiKey;
  const originalFrom = config.sendgridFromEmail;
  const originalBaseUrl = sgMail.client.defaultRequest.baseUrl;

  const accepted = (res: http.ServerResponse) => {
    res.writeHead(202, { 'x-message-id': 'stub-message-id-123' });
    res.end();
  };

  beforeAll(async () => {
    (http as any).request = blockExternal('http', nativeHttpRequest);
    (https as any).request = blockExternal('https', nativeHttpsRequest);

    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
        reply(res);
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    (http as any).request = nativeHttpRequest;
    (https as any).request = nativeHttpsRequest;
    config.sendgridApiKey = originalKey;
    config.sendgridFromEmail = originalFrom;
    sgMail.client.setDefaultRequest('baseUrl', originalBaseUrl);
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  afterEach(() => {
    expect(blockedExternal).toEqual([]);
  });

  beforeEach(() => {
    blockedExternal.length = 0;
    requests = [];
    reply = accepted;
    config.sendgridApiKey = API_KEY;
    config.sendgridFromEmail = 'sender@example.com';
    sgMail.client.setDefaultRequest('baseUrl', stubUrl);

    // setApiKey() resets the client's base URL to the real SendGrid host, and
    // sendEmailViaSendGrid() calls it on every send. Re-apply the stub address afterwards,
    // otherwise the request would go to api.sendgrid.com.
    const realSetApiKey = sgMail.setApiKey.bind(sgMail);
    jest.spyOn(sgMail, 'setApiKey').mockImplementation((key: unknown) => {
      realSetApiKey(key as string);
      sgMail.client.setDefaultRequest('baseUrl', stubUrl);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Extra check that the stub address is configured (the guards above are what really protect).
  const assertStubIsTarget = () => {
    expect(sgMail.client.defaultRequest.baseUrl).toBe(stubUrl);
    expect(stubUrl.startsWith('http://127.0.0.1:')).toBe(true);
  };

  it('loads as CommonJS and exposes the API the worker uses', () => {
    expect(typeof sgMail.setApiKey).toBe('function');
    expect(typeof sgMail.send).toBe('function');
    expect(sgMail.client).toBeDefined();
  });

  it('is the patched 8.x line (not the vulnerable 7.x)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { version } = require('@sendgrid/mail/package.json');
    expect(Number(version.split('.')[0])).toBeGreaterThanOrEqual(8);
  });

  it('returns the SendGrid message id from the x-message-id response header', async () => {
    assertStubIsTarget();

    const messageId = await sendEmailViaSendGrid('buyer@example.com', 'Receipt BP20261013001', '<p>Hello</p>');

    expect(messageId).toBe('stub-message-id-123');
    expect(requests).toHaveLength(1);
  });

  it('sends the expected request: endpoint, authorization, addresses, subject, html and tracking off', async () => {
    assertStubIsTarget();

    await sendEmailViaSendGrid('buyer@example.com', 'Receipt BP20261013001', '<p>Hello</p>');

    const request = requests[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v3/mail/send');
    expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request.headers['content-type']).toMatch(/application\/json/);

    const payload = JSON.parse(request.body);
    expect(payload.personalizations[0].to).toEqual([{ email: 'buyer@example.com' }]);
    expect(payload.from).toEqual({ email: 'sender@example.com' });
    expect(payload.subject).toBe('Receipt BP20261013001');
    expect(payload.content).toEqual([{ type: 'text/html', value: '<p>Hello</p>' }]);
    expect(payload.tracking_settings.click_tracking.enable).toBe(false);
    expect(payload.tracking_settings.open_tracking.enable).toBe(false);
  });

  it('sends non-ASCII subjects and bodies intact', async () => {
    assertStubIsTarget();

    await sendEmailViaSendGrid('buyer@example.com', 'Bridge Path 접수 완료', '<p>접수번호 BP20261013001</p>');

    const payload = JSON.parse(requests[0].body);
    expect(payload.subject).toBe('Bridge Path 접수 완료');
    expect(payload.content[0].value).toBe('<p>접수번호 BP20261013001</p>');
  });

  it('fails when SendGrid answers without a message id', async () => {
    assertStubIsTarget();
    reply = res => {
      res.writeHead(202);
      res.end();
    };

    await expect(sendEmailViaSendGrid('buyer@example.com', 's', '<p>b</p>')).rejects.toThrow(
      /SendGrid API error: No message ID in SendGrid response/
    );
  });

  it.each([
    [401, 'Unauthorized'],
    [400, 'Bad Request'],
    [403, 'Forbidden'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error']
  ])('turns an HTTP %i answer into a "SendGrid API error" that never contains the API key', async (status, text) => {
    assertStubIsTarget();
    reply = res => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: `${text} for key ${API_KEY}` }] }));
    };

    let error: Error | undefined;
    try {
      await sendEmailViaSendGrid('buyer@example.com', 's', '<p>b</p>');
    } catch (err) {
      error = err as Error;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toMatch(/^SendGrid API error: /);
    expect(error!.message).not.toContain(API_KEY);
    expect(error!.message.length).toBeLessThanOrEqual('SendGrid API error: '.length + 100);
  });

  it('refuses to send, without any request, when the API key or sender is not configured', async () => {
    config.sendgridApiKey = undefined;
    await expect(sendEmailViaSendGrid('buyer@example.com', 's', 'b')).rejects.toThrow(/not configured/);

    config.sendgridApiKey = API_KEY;
    config.sendgridFromEmail = undefined;
    await expect(sendEmailViaSendGrid('buyer@example.com', 's', 'b')).rejects.toThrow(/not configured/);

    expect(requests).toHaveLength(0);
  });
});
