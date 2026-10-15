// Versions of the privacy consent text that the server accepts with an estimate request.
//
// A request carries privacy_consent=true together with the identifier of the text the customer
// was shown (privacy_consent_version). The server stores the identifier and the time of the
// request, so it can later say which text a customer agreed to.
//
// The wording itself is NOT in this file and has not been written: it needs legal and
// operational review. By convention each approved version has its text in
// docs/privacy-consent/<version>.md (checked by a unit test), so the text and this list are
// reviewed and committed together.
//
// Until a version is approved and added to APPROVED_CONSENT_VERSIONS, production accepts no
// estimate at all (see getAcceptedConsentVersions and the 503 in routes/estimates.ts): a request
// without a valid, approved consent must never be stored.

// Placeholder for development and test. Never accepted in production.
export const DEV_DRAFT_CONSENT_VERSION = 'dev-draft';

// Approved production versions. Empty until the text is approved. Never add DEV_DRAFT here.
export const APPROVED_CONSENT_VERSIONS: readonly string[] = [];

// The column privacy_consent_version is VARCHAR(50).
export const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;

// Environments where the placeholder is allowed. Anything else is treated like production.
function isPreProduction(nodeEnv: string): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

export function getAcceptedConsentVersions(nodeEnv: string): readonly string[] {
  return isPreProduction(nodeEnv)
    ? [DEV_DRAFT_CONSENT_VERSION, ...APPROVED_CONSENT_VERSIONS]
    : APPROVED_CONSENT_VERSIONS;
}

// Warnings for the start-up log (the server still starts: health check and admin keep working).
export function consentWarnings(nodeEnv: string): string[] {
  if (isPreProduction(nodeEnv) || APPROVED_CONSENT_VERSIONS.length > 0) {
    return [];
  }
  return [
    'No approved privacy consent version: POST /api/estimates answers 503 until a version is added to ' +
      'APPROVED_CONSENT_VERSIONS in src/config/privacyConsent.ts (its text goes to docs/privacy-consent/<version>.md).'
  ];
}
