// Logic of the customer account pages that does not touch the page: the checks of the forms, the
// texts for the visitor, and the calls to /api/customers. Load config.js first.
//
// Nothing here reads or writes the DOM, builds HTML or keeps anything in the browser: the session
// is a cookie that scripts cannot read (HttpOnly), so this file never sees a token. Every text it
// returns is plain text: put it on the page with textContent.
(function () {
    'use strict';

    var MIN_PASSWORD_CHARACTERS = 8;
    var MAX_PASSWORD_BYTES = 72;
    var CODE_LENGTH = 6;
    var REQUEST_TIMEOUT_MS = 15000;

    var MESSAGES = Object.freeze({
        // Fields
        email_invalid: '이메일 형식을 확인해 주세요.',
        password_required: '비밀번호를 입력해 주세요.',
        password_short: '비밀번호는 8자 이상으로 입력해 주세요.',
        password_kind: '비밀번호에는 글자와 숫자가 모두 들어가야 해요.',
        password_long: '비밀번호가 너무 길어요. (최대 72바이트, 한글은 약 24자)',
        password_control: '비밀번호에 사용할 수 없는 문자가 들어 있어요.',
        password_email: '이메일과 같은 비밀번호는 사용할 수 없어요.',
        name_required: '이름을 입력해 주세요.',
        phone_required: '휴대폰 번호를 입력해 주세요.',
        phone_invalid: '전화번호는 숫자 7~15자리로 입력해 주세요. 숫자, 공백, +, -, ( )만 쓸 수 있어요.',
        consent_required: '개인정보 수집·이용에 동의해 주세요.',
        code_invalid_format: '인증코드 6자리를 모두 입력해 주세요.',

        // Answers of the server
        EMAIL_TAKEN: '이미 가입된 이메일이에요. 로그인해 주세요.',
        INVALID_CREDENTIALS: '이메일 또는 비밀번호가 맞지 않아요.',
        ACCOUNT_LOCKED: '로그인에 여러 번 실패해서 잠시 잠겼어요. 잠시 후 다시 시도해 주세요.',
        EMAIL_NOT_VERIFIED: '이메일 인증이 아직 끝나지 않았어요. 방금 보낸 인증코드를 입력해 주세요.',
        INVALID_CODE: '인증코드가 맞지 않아요. 다시 확인해 주세요.',
        CODE_EXPIRED: '인증코드가 만료됐어요. 코드를 다시 받아 주세요.',
        TOO_MANY_ATTEMPTS: '인증코드를 여러 번 틀렸어요. 코드를 다시 받아 주세요.',
        CODE_TOO_SOON: '인증코드는 1분에 한 번만 받을 수 있어요. 잠시 후 다시 시도해 주세요.',
        EMAIL_UNAVAILABLE: '이메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.',
        PRIVACY_CONSENT_NOT_CONFIGURED: '지금은 회원가입을 받을 수 없어요. 잠시 후 다시 시도해 주세요.',
        RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
        VALIDATION_ERROR: '입력한 내용을 확인해 주세요.',
        CUSTOMER_AUTH_REQUIRED: '로그인이 필요해요.',
        network: '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
        unexpected: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',

        // The address of the login page carries one of these after a Google/Kakao sign-in went wrong.
        provider_unavailable: '이 로그인 방식은 지금 사용할 수 없어요.',
        state_invalid: '로그인 시간이 지났거나 올바르지 않은 요청이에요. 다시 시도해 주세요.',
        cancelled: '로그인을 취소했어요.',
        email_missing: '이메일 정보를 받지 못했어요. 이메일 제공에 동의한 뒤 다시 시도하거나, 이메일로 가입해 주세요.',
        email_not_verified: '인증된 이메일이 아니에요. 이메일 인증을 마친 계정으로 다시 시도해 주세요.',
        provider_error: '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
        account_blocked: '이 계정으로는 로그인할 수 없어요. 다른 방법으로 로그인해 주세요.'
    });

    function messageFor(code) {
        return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code] : MESSAGES.unexpected;
    }

    // ------------------------------------------------------------------------------------------
    // Checks of the forms. They mirror the server (which has the last word) to save a round trip.

    function normalizeEmail(raw) {
        return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    }

    function checkEmail(raw) {
        var email = normalizeEmail(raw);
        if (email === '' || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return 'email_invalid';
        }
        return null;
    }

    function byteLength(text) {
        var bytes = 0;
        for (var i = 0; i < text.length; i += 1) {
            var code = text.charCodeAt(i);
            if (code < 0x80) {
                bytes += 1;
            } else if (code < 0x800) {
                bytes += 2;
            } else if (code >= 0xd800 && code <= 0xdbff) {
                bytes += 4;
                i += 1;
            } else {
                bytes += 3;
            }
        }
        return bytes;
    }

    // Returns the key of a message, or null when the password is fine.
    function checkPassword(raw, email) {
        if (typeof raw !== 'string' || raw === '') {
            return 'password_required';
        }
        if (byteLength(raw) > MAX_PASSWORD_BYTES) {
            return 'password_long';
        }
        if (Array.from(raw).length < MIN_PASSWORD_CHARACTERS) {
            return 'password_short';
        }
        if (/[\u0000-\u001f\u007f]/.test(raw)) {
            return 'password_control';
        }
        var hasLetter = false;
        try {
            hasLetter = new RegExp('\\p{L}', 'u').test(raw);
        } catch (error) {
            hasLetter = /[A-Za-zÀ-￿]/.test(raw);
        }
        if (!hasLetter || !/[0-9]/.test(raw)) {
            return 'password_kind';
        }
        var mail = normalizeEmail(email);
        if (mail !== '' && (raw.toLowerCase() === mail || raw.toLowerCase() === mail.split('@')[0])) {
            return 'password_email';
        }
        return null;
    }

    // required: the mobile phone is asked at sign-up, so an empty one is refused there.
    function checkPhone(raw, required) {
        var phone = typeof raw === 'string' ? raw.trim() : '';
        if (phone === '') {
            return required ? 'phone_required' : null;
        }
        var digits = phone.replace(/\D/g, '').length;
        return /^[0-9+\-()\s]+$/.test(phone) && digits >= 7 && digits <= 15 ? null : 'phone_invalid';
    }

    function isCodeFormat(raw) {
        return typeof raw === 'string' && /^[0-9]{6}$/.test(raw);
    }

    // Where a login may send the browser back to: a page of this site, never another address.
    function safeNext(raw) {
        if (typeof raw !== 'string' || raw === '' || raw.length > 300) {
            return '/';
        }
        if (raw.charAt(0) !== '/' || raw.charAt(1) === '/' || raw.indexOf('\\') !== -1 || /[\u0000-\u001f\u007f]/.test(raw)) {
            return '/';
        }
        return raw;
    }

    // ------------------------------------------------------------------------------------------
    // Calls. Always answer with { ok, status, body, code }, never with an exception.

    function apiBase() {
        var config = globalThis.BridgePathConfig;
        return config && typeof config.API_BASE === 'string' ? config.API_BASE : '';
    }

    async function call(method, path, payload, fetchImpl) {
        var doFetch = fetchImpl || globalThis.fetch;
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
        try {
            var init = {
                method: method,
                // The session cookie belongs to the API address; it is sent only with this setting.
                credentials: 'include',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            };
            if (payload !== undefined) {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(payload);
            }
            var response = await doFetch(apiBase() + '/api/customers' + path, init);
            var body;
            try {
                body = await response.json();
            } catch (parseError) {
                body = undefined;
            }
            var code = body && typeof body.code === 'string' ? body.code : null;
            if (!response.ok && code === null) {
                code = response.status === 429 ? 'RATE_LIMITED' : 'unexpected';
            }
            return { ok: !!response.ok, status: response.status, body: body || {}, code: response.ok ? null : code };
        } catch (error) {
            return { ok: false, status: 0, body: {}, code: 'network' };
        } finally {
            clearTimeout(timer);
        }
    }

    function oauthStartUrl(provider, next) {
        return apiBase() + '/api/customers/oauth/' + encodeURIComponent(provider) + '/start?next=' + encodeURIComponent(safeNext(next));
    }

    var api = Object.freeze({
        CODE_LENGTH: CODE_LENGTH,
        MESSAGES: MESSAGES,
        messageFor: messageFor,
        normalizeEmail: normalizeEmail,
        checkEmail: checkEmail,
        checkPassword: checkPassword,
        checkPhone: checkPhone,
        isCodeFormat: isCodeFormat,
        safeNext: safeNext,
        byteLength: byteLength,
        oauthStartUrl: oauthStartUrl,
        me: function (fetchImpl) { return call('GET', '/me', undefined, fetchImpl); },
        signup: function (payload, fetchImpl) { return call('POST', '/signup', payload, fetchImpl); },
        verifyEmail: function (email, code, fetchImpl) { return call('POST', '/verify-email', { email: email, code: code }, fetchImpl); },
        resendCode: function (email, fetchImpl) { return call('POST', '/resend-code', { email: email }, fetchImpl); },
        login: function (email, password, fetchImpl) { return call('POST', '/login', { email: email, password: password }, fetchImpl); },
        logout: function (fetchImpl) { return call('POST', '/logout', {}, fetchImpl); },
        providers: function (fetchImpl) { return call('GET', '/oauth/providers', undefined, fetchImpl); },
        // Completes an account that lacks the consent and/or the mobile phone (Google/Kakao sign-in).
        // Only what is given is sent: { privacy_consent, privacy_consent_version, phone }.
        complete: function (payload, fetchImpl) { return call('POST', '/me/complete', payload, fetchImpl); },
        // The requests of the signed-in customer, and one of them with the quote published for it.
        myEstimates: function (fetchImpl) { return call('GET', '/me/estimates', undefined, fetchImpl); },
        myEstimate: function (receiptId, fetchImpl) {
            return call('GET', '/me/estimates/' + encodeURIComponent(receiptId), undefined, fetchImpl);
        },
        resetRequest: function (email, fetchImpl) { return call('POST', '/password-reset/request', { email: email }, fetchImpl); },
        resetConfirm: function (email, code, newPassword, fetchImpl) {
            return call('POST', '/password-reset/confirm', { email: email, code: code, new_password: newPassword }, fetchImpl);
        }
    });

    globalThis.BridgePathAuth = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
