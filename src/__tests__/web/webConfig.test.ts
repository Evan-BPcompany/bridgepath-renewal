import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');

// config.js is sent to every visitor: it may hold the address of the API and the consent version
// and nothing secret.
describe('config.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require('../../../config.js');

  afterAll(() => {
    delete (globalThis as { BridgePathConfig?: unknown }).BridgePathConfig;
  });

  it('exposes exactly the four settings, frozen', () => {
    expect(Object.keys(config).sort()).toEqual([
      'API_BASE',
      'PRIVACY_CONSENT_URL',
      'PRIVACY_CONSENT_VERSION',
      'REQUEST_TIMEOUT_MS'
    ]);
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      'use strict';
      (config as { API_BASE: string }).API_BASE = 'https://evil.example';
    }).toThrow(TypeError);
  });

  it('points to the backend on its default port in development, without a trailing slash', () => {
    expect(config.API_BASE).toBe('http://localhost:4000');
    expect(config.API_BASE.endsWith('/')).toBe(false);
    expect(new URL(config.API_BASE).port).toBe('4000');
  });

  it('uses the development consent version the API accepts outside production, and a link only', () => {
    expect(config.PRIVACY_CONSENT_VERSION).toBe('dev-draft');
    expect(config.PRIVACY_CONSENT_URL).toBe('privacy-consent.html');
    expect(typeof config.REQUEST_TIMEOUT_MS).toBe('number');
    expect(config.REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('puts itself on globalThis (no implicit global) and exports for CommonJS only when module exists', () => {
    expect((globalThis as { BridgePathConfig?: unknown }).BridgePathConfig).toBe(config);
    expect(source).toContain('globalThis.BridgePathConfig = config');
    expect(source).toContain("typeof module !== 'undefined' && module.exports");
    // No assignment to an undeclared name: every assignment is to globalThis or to module.exports.
    expect(source).not.toMatch(/^\s*(window|self)\./m);
  });

  it('holds nothing secret: no key, token, password or credential-looking value (comments aside)', () => {
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/api[_-]?key|secret|password|passwd|token|bearer|authorization|sk_[a-z]|AKIA[0-9A-Z]{8}/i);
    expect(code).not.toMatch(/\/\/[^\s/]*:[^\s/@]*@/); // no user:password@host
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWT
  });

  it('is only the address, the consent settings and the timeout: no other setting slips in', () => {
    const keys = [...source.matchAll(/^\s{8}([A-Z_]+):/gm)].map(match => match[1]).sort();
    expect(keys).toEqual(['API_BASE', 'PRIVACY_CONSENT_URL', 'PRIVACY_CONSENT_VERSION', 'REQUEST_TIMEOUT_MS']);
  });

  it('the consent version is one the API accepts in development (config/privacyConsent.ts)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAcceptedConsentVersions } = require('../../config/privacyConsent');
    expect(getAcceptedConsentVersions('development')).toContain(config.PRIVACY_CONSENT_VERSION);
    expect(getAcceptedConsentVersions('production')).not.toContain(config.PRIVACY_CONSENT_VERSION);
  });
});
