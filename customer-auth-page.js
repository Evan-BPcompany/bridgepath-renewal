// The login / sign-up page (login.html): which step is shown and what each button does.
// The checks and the calls are in customer-auth.js. Everything from the server or from the visitor
// is put on the page with textContent; nothing here builds HTML.
(function () {
    'use strict';

    var COOLDOWN_SECONDS = 60;

    var STEPS = ['login', 'signup', 'code', 'reset-request', 'reset', 'consent'];

    var page = {
        // Replaced by the tests: the browser cannot be sent anywhere inside jsdom.
        go: function (url) {
            window.location.assign(url);
        },
        state: { email: '', next: '/', cooldownTimer: null, busy: false, step: 'login' }
    };

    function Auth() {
        return globalThis.BridgePathAuth;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, text) {
        byId(id).textContent = text;
    }

    function showError(id, message) {
        var box = byId(id);
        box.textContent = message;
        box.hidden = false;
    }

    function clearErrors() {
        var boxes = document.querySelectorAll('.auth-error');
        for (var i = 0; i < boxes.length; i += 1) {
            boxes[i].textContent = '';
            boxes[i].hidden = true;
        }
    }

    function notice(message) {
        var box = byId('notice');
        box.textContent = message || '';
        box.hidden = !message;
    }

    function messageOf(result) {
        return Auth().messageFor(result.code);
    }

    function show(step) {
        page.state.step = step;
        for (var i = 0; i < STEPS.length; i += 1) {
            byId('step-' + STEPS[i]).hidden = STEPS[i] !== step;
        }
        clearErrors();
    }

    // One request at a time: the button of the form that sent it waits for the answer.
    async function busy(buttonId, work) {
        if (page.state.busy) {
            return;
        }
        page.state.busy = true;
        var button = byId(buttonId);
        button.disabled = true;
        try {
            await work();
        } finally {
            page.state.busy = false;
            button.disabled = false;
        }
    }

    // ------------------------------------------------------------------------------------------
    // After a sign-in: the consent first when the account has none (Google/Kakao), then on to the page.

    function afterSignIn(customer) {
        if (customer && customer.consent_required) {
            show('consent');
            return;
        }
        page.go(page.state.next);
    }

    // ------------------------------------------------------------------------------------------
    // The code step

    function codeBoxes() {
        return byId('codeBoxes').querySelectorAll('.auth-code-box');
    }

    function readCode() {
        var boxes = codeBoxes();
        var code = '';
        for (var i = 0; i < boxes.length; i += 1) {
            code += boxes[i].value;
        }
        return code;
    }

    function clearCode() {
        var boxes = codeBoxes();
        for (var i = 0; i < boxes.length; i += 1) {
            boxes[i].value = '';
        }
        boxes[0].focus();
    }

    function startCooldown(seconds) {
        var button = byId('codeResend');
        var left = seconds;
        if (page.state.cooldownTimer) {
            clearInterval(page.state.cooldownTimer);
        }
        function paint() {
            button.disabled = left > 0;
            button.textContent = left > 0 ? '인증코드 재전송 (' + left + '초)' : '인증코드 재전송';
        }
        paint();
        page.state.cooldownTimer = setInterval(function () {
            left -= 1;
            paint();
            if (left <= 0) {
                clearInterval(page.state.cooldownTimer);
                page.state.cooldownTimer = null;
            }
        }, 1000);
    }

    function showCodeStep(email, cooldown) {
        page.state.email = email;
        setText('codeEmail', email);
        show('code');
        clearCode();
        startCooldown(typeof cooldown === 'number' ? cooldown : COOLDOWN_SECONDS);
    }

    async function submitCode() {
        var code = readCode();
        if (!Auth().isCodeFormat(code)) {
            return;
        }
        if (page.state.busy) {
            return;
        }
        page.state.busy = true;
        try {
            var result = await Auth().verifyEmail(page.state.email, code);
            if (result.ok) {
                afterSignIn(result.body.customer);
                return;
            }
            showError('codeError', messageOf(result));
            clearCode();
        } finally {
            page.state.busy = false;
        }
    }

    function wireCodeBoxes() {
        var boxes = codeBoxes();
        Array.prototype.forEach.call(boxes, function (box, index) {
            box.addEventListener('input', function () {
                var digits = box.value.replace(/\D/g, '');
                box.value = digits.slice(-1);
                if (box.value !== '' && index < boxes.length - 1) {
                    boxes[index + 1].focus();
                }
                if (Auth().isCodeFormat(readCode())) {
                    submitCode();
                }
            });
            box.addEventListener('keydown', function (event) {
                if (event.key === 'Backspace' && box.value === '' && index > 0) {
                    boxes[index - 1].focus();
                }
            });
            box.addEventListener('paste', function (event) {
                var text = event.clipboardData ? event.clipboardData.getData('text') : '';
                var digits = String(text).replace(/\D/g, '').slice(0, boxes.length);
                if (digits === '') {
                    return;
                }
                event.preventDefault();
                for (var i = 0; i < boxes.length; i += 1) {
                    boxes[i].value = digits.charAt(i);
                }
                boxes[Math.min(digits.length, boxes.length - 1)].focus();
                if (Auth().isCodeFormat(readCode())) {
                    submitCode();
                }
            });
        });
    }

    // ------------------------------------------------------------------------------------------
    // The forms

    async function submitLogin(event) {
        event.preventDefault();
        clearErrors();
        notice('');
        var email = byId('loginEmail').value;
        var password = byId('loginPassword').value;
        var emailProblem = Auth().checkEmail(email);
        if (emailProblem) {
            showError('loginError', Auth().messageFor(emailProblem));
            return;
        }
        if (password === '') {
            showError('loginError', Auth().messageFor('password_required'));
            return;
        }

        await busy('loginSubmit', async function () {
            var result = await Auth().login(Auth().normalizeEmail(email), password);
            byId('loginPassword').value = '';
            if (result.ok) {
                afterSignIn(result.body.customer);
            } else if (result.code === 'EMAIL_NOT_VERIFIED') {
                showCodeStep(Auth().normalizeEmail(email));
                notice(Auth().messageFor('EMAIL_NOT_VERIFIED'));
            } else {
                showError('loginError', messageOf(result));
            }
        });
    }

    async function submitSignup(event) {
        event.preventDefault();
        clearErrors();
        var email = byId('signupEmail').value;
        var password = byId('signupPassword').value;
        var name = byId('signupName').value.trim();
        var phone = byId('signupPhone').value;
        var company = byId('signupCompany').value.trim();

        var problem = Auth().checkEmail(email) || Auth().checkPassword(password, email);
        if (!problem && name === '') {
            problem = 'name_required';
        }
        problem = problem || Auth().checkPhone(phone);
        if (!problem && !byId('signupConsent').checked) {
            problem = 'consent_required';
        }
        if (problem) {
            showError('signupError', Auth().messageFor(problem));
            return;
        }

        await busy('signupSubmit', async function () {
            var normalized = Auth().normalizeEmail(email);
            var payload = {
                email: normalized,
                password: password,
                name: name,
                privacy_consent: true,
                privacy_consent_version: globalThis.BridgePathConfig.PRIVACY_CONSENT_VERSION
            };
            if (phone.trim() !== '') {
                payload.phone = phone.trim();
            }
            if (company !== '') {
                payload.company_name = company;
            }

            var result = await Auth().signup(payload);
            if (result.ok) {
                byId('signupPassword').value = '';
                showCodeStep(normalized, result.body.resend_after_seconds);
            } else if (result.code === 'CODE_TOO_SOON') {
                // The account was updated; the code that was sent a moment ago still counts.
                byId('signupPassword').value = '';
                showCodeStep(normalized, result.body.retry_after_seconds);
            } else {
                showError('signupError', messageOf(result));
            }
        });
    }

    // Not through busy(): the button stays disabled while the cooldown counts, which busy() would undo.
    async function resendCode() {
        if (page.state.busy) {
            return;
        }
        clearErrors();
        page.state.busy = true;
        var button = byId('codeResend');
        button.disabled = true;
        try {
            var result = await Auth().resendCode(page.state.email);
            if (result.ok) {
                clearCode();
                startCooldown(typeof result.body.resend_after_seconds === 'number' ? result.body.resend_after_seconds : COOLDOWN_SECONDS);
                notice('인증코드를 다시 보냈어요. 메일함을 확인해 주세요.');
            } else {
                showError('codeError', messageOf(result));
                button.disabled = page.state.cooldownTimer !== null;
            }
        } finally {
            page.state.busy = false;
        }
    }

    async function submitResetRequest(event) {
        event.preventDefault();
        clearErrors();
        var email = byId('resetEmail').value;
        var problem = Auth().checkEmail(email);
        if (problem) {
            showError('resetRequestError', Auth().messageFor(problem));
            return;
        }
        await busy('resetRequestSubmit', async function () {
            var normalized = Auth().normalizeEmail(email);
            var result = await Auth().resetRequest(normalized);
            if (result.ok) {
                page.state.email = normalized;
                setText('resetEmailShown', normalized);
                show('reset');
                byId('resetCode').focus();
                notice('가입된 이메일이라면 인증코드를 보냈어요. 메일함을 확인해 주세요.');
            } else {
                showError('resetRequestError', messageOf(result));
            }
        });
    }

    async function submitReset(event) {
        event.preventDefault();
        clearErrors();
        var code = byId('resetCode').value.trim();
        var password = byId('resetPassword').value;
        var problem = Auth().isCodeFormat(code) ? Auth().checkPassword(password, page.state.email) : 'code_invalid_format';
        if (problem) {
            showError('resetError', Auth().messageFor(problem));
            return;
        }
        await busy('resetSubmit', async function () {
            var result = await Auth().resetConfirm(page.state.email, code, password);
            byId('resetPassword').value = '';
            if (result.ok) {
                byId('resetCode').value = '';
                byId('loginEmail').value = page.state.email;
                show('login');
                notice('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.');
            } else {
                showError('resetError', messageOf(result));
            }
        });
    }

    async function resetAgain() {
        clearErrors();
        var result = await Auth().resetRequest(page.state.email);
        if (result.ok) {
            notice('인증코드를 다시 보냈어요. 메일함을 확인해 주세요.');
        } else {
            showError('resetError', messageOf(result));
        }
    }

    async function submitConsent(event) {
        event.preventDefault();
        clearErrors();
        if (!byId('consentCheck').checked) {
            showError('consentError', Auth().messageFor('consent_required'));
            return;
        }
        await busy('consentSubmit', async function () {
            var result = await Auth().consent(globalThis.BridgePathConfig.PRIVACY_CONSENT_VERSION);
            if (result.ok) {
                page.go(page.state.next);
            } else if (result.code === 'CUSTOMER_AUTH_REQUIRED') {
                show('login');
                notice('로그인 시간이 지났어요. 다시 로그인해 주세요.');
            } else {
                showError('consentError', messageOf(result));
            }
        });
    }

    // ------------------------------------------------------------------------------------------
    // Start

    async function showSocialButtons() {
        var result = await Auth().providers();
        if (!result.ok || !result.body.providers) {
            return;
        }
        var any = false;
        [['kakao', 'kakaoBtn'], ['google', 'googleBtn']].forEach(function (pair) {
            var enabled = result.body.providers[pair[0]] === true;
            var link = byId(pair[1]);
            link.hidden = !enabled;
            if (enabled) {
                link.setAttribute('href', Auth().oauthStartUrl(pair[0], page.state.next));
                any = true;
            }
        });
        byId('socialBox').hidden = !any;
    }

    async function init() {
        var params = new URLSearchParams(window.location.search);
        page.state.next = Auth().safeNext(params.get('next') || '/');

        byId('loginForm').addEventListener('submit', submitLogin);
        byId('signupForm').addEventListener('submit', submitSignup);
        byId('resetRequestForm').addEventListener('submit', submitResetRequest);
        byId('resetForm').addEventListener('submit', submitReset);
        byId('consentForm').addEventListener('submit', submitConsent);
        byId('toSignup').addEventListener('click', function () { notice(''); show('signup'); });
        byId('signupBack').addEventListener('click', function () { notice(''); show('login'); });
        byId('toReset').addEventListener('click', function () {
            notice('');
            byId('resetEmail').value = byId('loginEmail').value;
            show('reset-request');
        });
        byId('resetRequestBack').addEventListener('click', function () { notice(''); show('login'); });
        byId('resetBack').addEventListener('click', function () { notice(''); show('login'); });
        byId('resetAgain').addEventListener('click', resetAgain);
        byId('codeResend').addEventListener('click', resendCode);
        byId('codeBack').addEventListener('click', function () { notice(''); show('signup'); });
        wireCodeBoxes();

        var error = params.get('error');
        var wantsConsent = params.get('step') === 'consent';
        if (params.get('mode') === 'signup') {
            show('signup');
        }
        if (error) {
            notice(Auth().messageFor(error));
        }

        showSocialButtons();

        // Someone who is already signed in has nothing to do here (unless a step is waiting for them).
        var me = await Auth().me();
        if (me.ok && me.body.customer) {
            if (me.body.customer.consent_required && (wantsConsent || !error)) {
                show('consent');
            } else if (!error) {
                page.go(page.state.next);
            }
        }
    }

    globalThis.BridgePathAuthPage = page;
    page.init = init;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
