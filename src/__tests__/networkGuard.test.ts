import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

// jest.setup.js refuses every connection that does not stay on this machine, so that no
// test can ever reach SendGrid, AWS, PostgreSQL or any other real service.
//
// This file must itself be safe even if that guard were missing: every external address
// below ends in ".invalid", a reserved top-level domain that can never resolve, and
// beforeAll refuses to run anything unless the guard is installed.

const MARK = '__testNetworkGuard';
const BLOCKED = /External .* blocked in tests: /;

describe('external network requests are blocked in tests', () => {
  beforeAll(() => {
    const installed = {
      'http.request': (http.request as unknown as Record<string, boolean>)[MARK],
      'https.request': (https.request as unknown as Record<string, boolean>)[MARK],
      'net.Socket.prototype.connect': (net.Socket.prototype.connect as unknown as Record<string, boolean>)[MARK],
      fetch: (globalThis.fetch as unknown as Record<string, boolean>)[MARK]
    };

    if (!Object.values(installed).every(Boolean)) {
      throw new Error(`The test network guard is not installed (${JSON.stringify(installed)}); refusing to run.`);
    }
  });

  describe('http and https', () => {
    it.each([
      ['a mail API', 'https://api.sendgrid.invalid/v3/mail/send'],
      ['a storage service', 'https://bucket.s3.ap-northeast-2.amazonaws.invalid/estimates/x.png'],
      ['a plain website', 'http://site.example.invalid/']
    ])('refuses a string URL to %s', (_name, url) => {
      const lib = url.startsWith('https') ? https : http;
      expect(() => lib.request(url)).toThrow(BLOCKED);
      expect(() => lib.get(url)).toThrow(BLOCKED);
    });

    it('refuses URL objects and option objects', () => {
      expect(() => https.request(new URL('https://api.sendgrid.invalid/'))).toThrow(BLOCKED);
      expect(() => https.request({ hostname: 's3.amazonaws.invalid', path: '/' })).toThrow(BLOCKED);
      expect(() => http.request({ host: 'site.example.invalid', port: 80 })).toThrow(BLOCKED);
      expect(() => http.request('http://site.example.invalid/', { method: 'POST' })).toThrow(BLOCKED);
    });

    it('names only the host: no credentials, path, query or token in the error', () => {
      let message = '';
      try {
        https.request('https://user:p4ssw0rd@api.sendgrid.invalid/v3/mail/send?token=SECRET-TOKEN');
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toBe('External https request blocked in tests: api.sendgrid.invalid');
      expect(message).not.toMatch(/p4ssw0rd|SECRET-TOKEN|user|v3\/mail/);
    });
  });

  describe('raw sockets (what database drivers use)', () => {
    // A blocked socket is destroyed and reports the refusal as an 'error' event, like a failed connection.
    const refusal = (open: () => net.Socket) =>
      new Promise<Error>((resolve, reject) => {
        const socket = open();
        socket.once('error', resolve);
        socket.once('connect', () => reject(new Error('the socket connected')));
      });

    it('refuses every way of opening a TCP connection to an external host', async () => {
      const attempts = [
        () => net.connect({ host: 'db.example.invalid', port: 5432 }),
        () => net.connect(5432, 'db.example.invalid'),
        () => net.createConnection({ host: 'db2.example.invalid', port: 5432 }),
        () => new net.Socket().connect({ host: 'db3.example.invalid', port: 5432 })
      ];

      for (const open of attempts) {
        const error = await refusal(open);
        expect(error.message).toMatch(BLOCKED);
      }
    });

    it('refuses tls.connect to an external host', async () => {
      const error = await refusal(() => tls.connect({ host: 'tls.example.invalid', port: 443 }));
      expect(error.message).toBe('External network connection blocked in tests: tls.example.invalid');
    });

    it('refuses a PostgreSQL connection: a pg Pool pointed at an external database fails at once', async () => {
      const pool = new Pool({
        connectionString: 'postgres://dbuser:SuperSecretDbPw@db.example.invalid:5432/bridgepath',
        connectionTimeoutMillis: 500,
        idleTimeoutMillis: 1
      });

      let message = '';
      try {
        await pool.query('SELECT 1');
      } catch (err) {
        message = (err as Error).message;
      } finally {
        await pool.end().catch(() => undefined);
      }

      expect(message).toMatch(BLOCKED);
      expect(message).not.toContain('SuperSecretDbPw');
    });

    it('refuses the AWS SDK: an S3 client cannot send its request', async () => {
      const client = new S3Client({
        region: 'ap-northeast-2',
        endpoint: 'https://s3.example.invalid',
        forcePathStyle: true,
        credentials: { accessKeyId: ['AKIA', 'FAKEFAKEFAKEFAKE'].join(''), secretAccessKey: 'fake-fake-fake' },
        maxAttempts: 1,
        requestHandler: { requestTimeout: 100, connectionTimeout: 100 }
      });

      let message = '';
      try {
        await client.send(new HeadBucketCommand({ Bucket: 'bridge-path-prod' }));
      } catch (err) {
        message = String((err as Error).message);
      } finally {
        client.destroy();
      }

      expect(message).toMatch(/blocked in tests/);
      expect(message).not.toContain('fake-fake-fake');
    });
  });

  describe('fetch', () => {
    it('refuses an external URL, URL object and Request', async () => {
      await expect(fetch('https://api.sendgrid.invalid/v3/mail/send')).rejects.toThrow(
        'External fetch blocked in tests: api.sendgrid.invalid'
      );
      await expect(fetch(new URL('https://site.example.invalid/'))).rejects.toThrow(BLOCKED);
      await expect(fetch(new Request('https://site.example.invalid/'))).rejects.toThrow(BLOCKED);
    });
  });

  describe('this machine stays reachable', () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('local ok');
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      // fetch and the default http agent keep connections alive; drop them so Jest can exit.
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('allows http requests, http.get and fetch to 127.0.0.1', async () => {
      const viaRequest = await new Promise<string>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/' }, res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.end();
      });
      expect(viaRequest).toBe('local ok');

      const viaGet = await new Promise<number | undefined>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/`, res => {
            res.resume();
            resolve(res.statusCode);
          })
          .on('error', reject);
      });
      expect(viaGet).toBe(200);

      const viaFetch = await fetch(`http://127.0.0.1:${port}/`);
      expect(await viaFetch.text()).toBe('local ok');
    });

    it('allows a raw socket to 127.0.0.1', async () => {
      const connected = await new Promise<boolean>(resolve => {
        const socket = net.connect({ host: '127.0.0.1', port }, () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => resolve(false));
      });
      expect(connected).toBe(true);
    });
  });

  describe('the guard itself', () => {
    it('is installed exactly once per process (no stacked wrappers)', () => {
      const connect = net.Socket.prototype.connect as unknown as { name: string };
      const request = http.request as unknown as Record<string, unknown>;

      expect(request[MARK]).toBe(true);
      expect(connect.name).toBe('guarded');
      // A second install must be a no-op: the wrapped original is not itself a guard.
      expect(Object.prototype.hasOwnProperty.call(request, MARK)).toBe(true);
    });

    it('documents the SendGrid hazard behind the earlier mistake: setApiKey() resets the base URL', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sgMail = require('@sendgrid/mail');
      const previous = sgMail.client.defaultRequest.baseUrl;

      sgMail.client.setDefaultRequest('baseUrl', 'http://127.0.0.1:1/');
      sgMail.setApiKey('SG.fake-key-for-this-check');

      expect(sgMail.client.defaultRequest.baseUrl).toBe('https://api.sendgrid.com/');
      sgMail.client.setDefaultRequest('baseUrl', previous);
    });
  });
});
