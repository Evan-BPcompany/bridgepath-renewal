// The customer type, name and privacy consent that every valid estimate request carries since
// customer type and consent became required. Tests spread these into request bodies so that the
// test is about something else (contact, specification, limits, ...).

// Accepted in development and test only (config/privacyConsent.ts).
export const TEST_CONSENT_VERSION = 'dev-draft';

// As a client sends it (JSON body).
export const PROFILE = {
  customer_type: 'individual_startup',
  customer_name: 'Kim',
  privacy_consent: true,
  privacy_consent_version: TEST_CONSENT_VERSION
} as const;

// As createEstimate() receives it from the route.
export const SERVICE_PROFILE = {
  customer_type: 'individual_startup',
  privacy_consent_version: TEST_CONSENT_VERSION
} as const;

// The same profile as multipart form fields (form data has no booleans: consent is the text "true").
export function withMultipartProfile<T extends { field(name: string, value: string): T }>(req: T): T {
  return req
    .field('customer_type', PROFILE.customer_type)
    .field('customer_name', PROFILE.customer_name)
    .field('privacy_consent', 'true')
    .field('privacy_consent_version', PROFILE.privacy_consent_version);
}
