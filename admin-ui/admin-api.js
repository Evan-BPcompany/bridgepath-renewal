// The calls of the admin screen to the admin API of the same server (/admin/...).
//
// The session is the pair of HttpOnly cookies the server sets at login: nothing is read, kept or
// logged here (no token in the page, nothing in localStorage). A request that is answered with
// 401 is tried once more after a refresh of the session (POST /admin/token/refresh); if that fails
// too, the screen is told that the session is over. Every function answers with a result and never
// throws: { ok: true, data, pagination? } or { ok: false, status, code, message, ... }.
(function () {
    'use strict';

    var BASE = '/admin';

    // What the screen says for the codes and statuses the API answers with.
    var MESSAGES = Object.freeze({
        network: '서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        server: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.',
        rate_limited: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.',
        unauthenticated: '로그인이 필요해요.',
        forbidden: '이 작업을 할 권한이 없어요.',
        not_found: '찾을 수 없어요.',
        invalid_credentials: '아이디 또는 비밀번호가 맞지 않아요.',
        locked: '로그인 시도가 너무 많아 계정이 잠겼어요. 잠시 뒤 다시 시도해 주세요.',
        inactive: '사용할 수 없는 계정이에요. 관리자에게 문의해 주세요.',
        validation: '입력한 내용을 확인해 주세요.',
        STATUS_CONFLICT: '다른 담당자가 먼저 상태를 바꿨어요. 화면을 새로 고친 뒤 다시 시도해 주세요.',
        SAME_STATUS: '이미 그 상태예요.',
        INVALID_TRANSITION: '이 상태에서는 그 상태로 바꿀 수 없어요.',
        INSUFFICIENT_ROLE: '이 상태 변경은 관리자만 할 수 있어요.',
        REASON_REQUIRED: '이 상태로 바꾸려면 사유를 적어 주세요.',
        MEMO_TOO_LONG: '메모는 5,000자까지 쓸 수 있어요.',
        ESTIMATE_NOT_FOUND: '접수를 찾을 수 없어요.',
        NO_CUSTOMER_ACCOUNT: '로그인하지 않고 보낸 접수라 고객이 사이트에서 견적을 볼 수 없어요.',
        QUOTE_CONFLICT: '다른 담당자가 먼저 견적을 고쳤어요. 화면을 새로 고친 뒤 다시 시도해 주세요.',
        NO_QUOTE: '게시할 견적이 아직 저장되지 않았어요.',
        QUOTE_INCOMPLETE: '게시하려면 항목이 1개 이상, 합계가 0원보다 커야 하고 견적 유효기간이 지나지 않아야 해요.',
        NOTHING_TO_PUBLISH: '게시한 뒤로 바뀐 내용이 없어요.',
        PASSWORD_POLICY_VIOLATION: '새 비밀번호가 규칙에 맞지 않아요.',
        PASSWORD_TOO_LONG: '새 비밀번호가 너무 길어요. (72바이트까지)',
        PASSWORD_SAME_AS_CURRENT: '새 비밀번호는 지금 비밀번호와 달라야 해요.',
        INVALID_CURRENT_PASSWORD: '지금 비밀번호가 맞지 않아요.',
        ACCOUNT_LOCKED: '비밀번호를 여러 번 틀려 계정이 잠겼어요. 잠시 뒤 다시 시도해 주세요.',
        ACCOUNT_UNAVAILABLE: '사용할 수 없는 계정이에요.',
        unexpected: '요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
    });

    function messageFor(code, fallback) {
        return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code] : (fallback || MESSAGES.unexpected);
    }

    function queryString(query) {
        var parts = [];
        Object.keys(query || {}).forEach(function (key) {
            var value = query[key];
            if (value !== undefined && value !== null && String(value) !== '') {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
            }
        });
        return parts.length > 0 ? '?' + parts.join('&') : '';
    }

    // Turns an answer of the API into the result of this module.
    function failure(status, body, headers) {
        var code = body && typeof body.code === 'string' ? body.code : '';
        var error = body && typeof body.error === 'string' ? body.error : '';

        if (status === 401) {
            if (/locked/i.test(error)) {
                return { ok: false, status: status, code: 'locked', message: MESSAGES.locked };
            }
            if (/inactive/i.test(error)) {
                return { ok: false, status: status, code: 'inactive', message: MESSAGES.inactive };
            }
            // The password change answers 401 with its own codes (wrong current password, locked).
            if (code) {
                return { ok: false, status: status, code: code, message: messageFor(code) };
            }
            return { ok: false, status: status, code: 'unauthenticated', message: MESSAGES.unauthenticated };
        }
        if (status === 403) {
            if (code === 'PASSWORD_CHANGE_REQUIRED') {
                return { ok: false, status: status, code: code, message: '비밀번호를 먼저 바꿔야 해요.' };
            }
            return { ok: false, status: status, code: code || 'forbidden', message: messageFor(code, MESSAGES.forbidden) };
        }
        if (status === 404) {
            return { ok: false, status: status, code: code || 'not_found', message: messageFor(code, MESSAGES.not_found) };
        }
        if (status === 429) {
            var retry = headers && typeof headers.get === 'function' ? Number(headers.get('Retry-After')) : NaN;
            return {
                ok: false, status: status, code: 'rate_limited', message: MESSAGES.rate_limited,
                retryAfterSeconds: isFinite(retry) && retry > 0 ? retry : null
            };
        }
        if (status === 400 || status === 409 || status === 413 || status === 415 || status === 422) {
            var result = { ok: false, status: status, code: code || 'validation', message: messageFor(code, MESSAGES.validation) };
            // A list of fields for a bad query, an object for a password that breaks the policy.
            if (body && body.details !== undefined && body.details !== null) {
                result.details = body.details;
            }
            if (body && typeof body.current_status === 'string') {
                result.currentStatus = body.current_status;
            }
            return result;
        }
        if (typeof status === 'number' && status >= 500) {
            return { ok: false, status: status, code: 'server', message: MESSAGES.server };
        }
        return { ok: false, status: status, code: code || 'unexpected', message: MESSAGES.unexpected };
    }

    function create(fetchImpl) {
        var onSessionEnded = function () {};
        var onPasswordChangeRequired = function () {};
        var refreshing = null;

        function raw(method, path, options) {
            var settings = options || {};
            var init = {
                method: method,
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            };
            if (settings.json !== undefined) {
                init.headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(settings.json);
            }
            return fetchImpl(BASE + path + queryString(settings.query), init).then(
                function (response) {
                    return response.json().then(
                        function (body) { return { status: response.status, headers: response.headers, body: body }; },
                        function () { return { status: response.status, headers: response.headers, body: undefined }; }
                    );
                },
                function () { return { status: 0, headers: null, body: undefined, network: true }; }
            );
        }

        function toResult(answer) {
            if (answer.network) {
                return { ok: false, status: 0, code: 'network', message: MESSAGES.network };
            }
            if (answer.status >= 200 && answer.status < 300) {
                var body = answer.body && typeof answer.body === 'object' ? answer.body : {};
                var result = { ok: true, status: answer.status, data: body.data !== undefined ? body.data : body };
                if (body.pagination) {
                    result.pagination = body.pagination;
                }
                if (typeof body.message === 'string') {
                    result.message = body.message;
                }
                return result;
            }
            return failure(answer.status, answer.body, answer.headers);
        }

        // One refresh at a time, even when several requests found the session expired together.
        function refresh() {
            if (!refreshing) {
                refreshing = raw('POST', '/token/refresh').then(
                    function (answer) { refreshing = null; return answer.status === 200; },
                    function () { refreshing = null; return false; }
                );
            }
            return refreshing;
        }

        // `auth: false` for the calls that are answered without a session (login). `quiet` for a call
        // that only asks whether there is a session: when there is none, nobody is told it ended.
        function request(method, path, options) {
            var settings = options || {};
            return raw(method, path, settings).then(function (answer) {
                if (answer.status === 401 && settings.auth !== false && !answer.network && !(answer.body && answer.body.code)) {
                    return refresh().then(function (refreshed) {
                        if (!refreshed) {
                            if (!settings.quiet) {
                                onSessionEnded();
                            }
                            return toResult(answer);
                        }
                        return raw(method, path, settings).then(function (second) {
                            if (second.status === 401 && !settings.quiet) {
                                onSessionEnded();
                            }
                            return finish(second);
                        });
                    });
                }
                return finish(answer);
            });
        }

        function finish(answer) {
            var result = toResult(answer);
            if (!result.ok && result.code === 'PASSWORD_CHANGE_REQUIRED') {
                onPasswordChangeRequired();
            }
            return result;
        }

        return {
            onSessionEnded: function (callback) { onSessionEnded = callback; },
            onPasswordChangeRequired: function (callback) { onPasswordChangeRequired = callback; },

            login: function (username, password) {
                return request('POST', '/login', { json: { username: username, password: password }, auth: false }).then(function (result) {
                    if (result.ok) {
                        // The login answer is { message, admin }.
                        return { ok: true, status: result.status, data: result.data.admin || null };
                    }
                    if (result.code === 'unauthenticated') {
                        return { ok: false, status: result.status, code: 'invalid_credentials', message: MESSAGES.invalid_credentials };
                    }
                    return result;
                });
            },
            logout: function () { return request('POST', '/logout', { json: {} }); },
            me: function () { return request('GET', '/me', { quiet: true }); },
            changePassword: function (current, next) {
                return request('PATCH', '/me/password', { json: { current_password: current, new_password: next } });
            },

            list: function (query) { return request('GET', '/estimates', { query: query }); },
            detail: function (id) { return request('GET', '/estimates/' + encodeURIComponent(id)); },
            changeStatus: function (id, body) {
                return request('PATCH', '/estimates/' + encodeURIComponent(id) + '/status', { json: body });
            },
            // The detailed quote of one request: the working copy, saving it, and publishing it to the customer.
            quote: function (id) { return request('GET', '/estimates/' + encodeURIComponent(id) + '/quote'); },
            saveQuote: function (id, body) {
                return request('PUT', '/estimates/' + encodeURIComponent(id) + '/quote', { json: body });
            },
            publishQuote: function (id, expectedEditSeq) {
                return request('POST', '/estimates/' + encodeURIComponent(id) + '/quote/publish', { json: { expected_edit_seq: expectedEditSeq } });
            },
            addMemo: function (id, content) {
                return request('POST', '/estimates/' + encodeURIComponent(id) + '/memos', { json: { content: content } });
            }
        };
    }

    var api = { create: create, messageFor: messageFor, queryString: queryString, MESSAGES: MESSAGES };
    globalThis.AdminApi = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
