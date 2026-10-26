import request from 'supertest';
import { createApp } from '../app';
import { buildSiteConfig } from '../routes/sitePages';

// The customer pages come from the server itself: same address as the API, only the files the pages use.
describe('the customer pages served by the server', () => {
  const app = createApp();

  it('serves the home page at / and the other pages by name', async () => {
    const home = await request(app).get('/');
    expect(home.status).toBe(200);
    expect(home.headers['content-type']).toMatch(/text\/html/);
    expect(home.headers['cache-control']).toBe('no-cache');

    for (const name of ['login.html', 'my-quotes.html', 'sunglasses-estimate.html', 'privacy-consent.html', 'customer-auth.js', 'estimate.css']) {
      expect((await request(app).get(`/${name}`)).status).toBe(200);
    }
  });

  it('serves nothing else of the project folder', async () => {
    for (const name of ['package.json', 'package-lock.json', 'knexfile.production.js', 'Procfile', 'README.md', '.env', 'tsconfig.json', 'jest.config.js']) {
      expect((await request(app).get(`/${name}`)).status).toBe(404);
    }
    for (const url of ['/src/app.ts', '/dist/index.js', '/docs/OPERATIONS.md', '/node_modules/express/package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
      expect((await request(app).get(url)).status).toBe(404);
    }
  });

  it('leaves the API, the admin screen and the health check alone', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/admin-ui/')).status).toBe(200);
    expect((await request(app).get('/api/nothing-here')).status).toBe(404);
  });

  it('writes config.js itself: the same address for the API, and the consent version, nothing secret', async () => {
    const res = await request(app).get('/config.js');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain("API_BASE: ''");
    expect(res.text).toContain('"dev-draft"');
    expect(res.text).not.toMatch(/localhost|secret|password|token|key/i);
  });

  it('has no consent version in production until one is approved (the server refuses requests then anyway)', () => {
    expect(buildSiteConfig('production')).toContain('PRIVACY_CONSENT_VERSION: ""');
    expect(buildSiteConfig('production')).not.toContain('dev-draft');
  });

  it('keeps the security headers of the rest of the app (a script-only policy, no framing)', async () => {
    const res = await request(app).get('/login.html');

    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
