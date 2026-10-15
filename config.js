// Settings of the browser side of the estimate forms.
//
// Load this file before estimate-api.js. It holds nothing but the address of the API and the
// version of the privacy consent text; never put a secret, a key or a password here: everything in
// this file is sent to every visitor.
//
// For another environment replace this file when deploying (see the README, "Front end").
(function () {
    'use strict';

    var config = Object.freeze({
        // Where the API listens. Development: the backend on its default port. No trailing slash.
        API_BASE: 'http://localhost:4000',

        // The version of the consent text that is shown to the customer and sent with the request
        // (privacy_consent_version). 'dev-draft' is accepted by the server in development and test
        // only; production needs an approved version that has its text in docs/privacy-consent/.
        PRIVACY_CONSENT_VERSION: 'dev-draft',

        // Where the consent text is shown. Only the link exists; the wording is not written yet.
        PRIVACY_CONSENT_URL: 'privacy-consent.html',

        // How long to wait for the answer to a request, in milliseconds.
        REQUEST_TIMEOUT_MS: 60000
    });

    globalThis.BridgePathConfig = config;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = config;
    }
})();
