import fs from 'fs';
import path from 'path';
import {
  APPROVED_CONSENT_VERSIONS,
  CONSENT_VERSION_PATTERN,
  DEV_DRAFT_CONSENT_VERSION,
  consentWarnings,
  getAcceptedConsentVersions
} from '../config/privacyConsent';

// Which consent versions the server accepts, per environment. The consent wording itself has not
// been written (it needs legal and operational review); only the structure exists.
describe('privacy consent versions', () => {
  it('accepts dev-draft in development and test', () => {
    expect(getAcceptedConsentVersions('development')).toContain(DEV_DRAFT_CONSENT_VERSION);
    expect(getAcceptedConsentVersions('test')).toContain(DEV_DRAFT_CONSENT_VERSION);
    expect(DEV_DRAFT_CONSENT_VERSION).toBe('dev-draft');
  });

  it('rejects dev-draft in production and in any environment that is not development or test', () => {
    for (const env of ['production', 'staging', 'prod', '', 'PRODUCTION']) {
      expect(getAcceptedConsentVersions(env)).not.toContain(DEV_DRAFT_CONSENT_VERSION);
    }
  });

  it('production accepts exactly the approved versions, which are none until the text is approved', () => {
    expect(getAcceptedConsentVersions('production')).toEqual([...APPROVED_CONSENT_VERSIONS]);
    expect(APPROVED_CONSENT_VERSIONS).toEqual([]);
  });

  it('never lists dev-draft as approved, and every approved version fits the database column', () => {
    expect(APPROVED_CONSENT_VERSIONS).not.toContain(DEV_DRAFT_CONSENT_VERSION);
    for (const version of APPROVED_CONSENT_VERSIONS) {
      expect(version).toMatch(CONSENT_VERSION_PATTERN);
      expect(version.length).toBeLessThanOrEqual(50);
    }
    expect(DEV_DRAFT_CONSENT_VERSION).toMatch(CONSENT_VERSION_PATTERN);
  });

  it('every approved version has its text in docs/privacy-consent/<version>.md', () => {
    for (const version of APPROVED_CONSENT_VERSIONS) {
      const file = path.join(__dirname, '..', '..', 'docs', 'privacy-consent', `${version}.md`);
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it('the version pattern refuses blanks, slashes, spaces and anything over 50 characters', () => {
    for (const bad of ['', ' ', 'v 1', 'v/1', '../x', '-v1', 'a'.repeat(51)]) {
      expect(bad).not.toMatch(CONSENT_VERSION_PATTERN);
    }
    expect('2026-10.v1').toMatch(CONSENT_VERSION_PATTERN);
  });

  describe('start-up warning', () => {
    it('warns in production while no version is approved, naming where to add one', () => {
      const warnings = consentWarnings('production');

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/503/);
      expect(warnings[0]).toMatch(/APPROVED_CONSENT_VERSIONS/);
      expect(warnings[0]).toMatch(/docs\/privacy-consent/);
    });

    it('is quiet in development and test', () => {
      expect(consentWarnings('development')).toEqual([]);
      expect(consentWarnings('test')).toEqual([]);
    });
  });
});
