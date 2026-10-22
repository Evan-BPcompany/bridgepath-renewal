// The admin screen (PRD FR-5): sign in, the list of estimate requests, one request with its status,
// history and memos. It talks to the admin API of the same server through admin-api.js and uses
// the words of admin-labels.js.
//
// Everything that comes from the server, and so from a customer (a name, a message, a file name,
// the specification), is put in with textContent; no element is built from a string and there is
// no innerHTML in this file. The session is the HttpOnly cookies of the server: nothing is stored.
(function () {
    'use strict';

    var PAGE_SIZE = 20;
    var REASON_MAX = 1000;
    var MEMO_MAX = 5000;

    var SORTS = [
        ['created_at:desc', '접수 최신순'],
        ['created_at:asc', '접수 오래된순'],
        ['updated_at:desc', '최근 변경순'],
        ['status:asc', '상태순'],
        ['receipt_id:desc', '접수번호순']
    ];

    // ------------------------------------------------------------------------------------------
    // Small helpers

    function h(tag, props, children) {
        var element = document.createElement(tag);
        var settings = props || {};
        Object.keys(settings).forEach(function (key) {
            var value = settings[key];
            if (value === undefined || value === null || value === false) {
                return;
            }
            if (key === 'class') {
                element.className = value;
            } else if (key === 'text') {
                element.textContent = value;
            } else if (key === 'on') {
                Object.keys(value).forEach(function (name) { element.addEventListener(name, value[name]); });
            } else if (key === 'value') {
                element.value = value;
            } else if (value === true) {
                element.setAttribute(key, '');
            } else {
                element.setAttribute(key, String(value));
            }
        });
        (children || []).forEach(function (child) {
            if (child === null || child === undefined || child === false) {
                return;
            }
            element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return element;
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function labeled(label, control, hint) {
        return h('div', { class: 'field' }, [h('label', { for: control.id, text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null]);
    }

    function badge(status) {
        var labels = globalThis.AdminLabels;
        return h('span', { class: 'badge badge-' + labels.statusTone(status), text: labels.statusLabel(status) });
    }

    function definitionList(rows) {
        var list = h('dl', { class: 'facts' });
        rows.forEach(function (row) {
            if (row[1] === null || row[1] === undefined || row[1] === '') {
                return;
            }
            list.appendChild(h('dt', { text: row[0] }));
            list.appendChild(h('dd', { class: row[2] || '', text: String(row[1]) }));
        });
        return list;
    }

    // ------------------------------------------------------------------------------------------
    // The routes: #/login, #/password, #/estimates?..., #/estimates/<id>

    function parseHash(hash) {
        var text = String(hash || '').replace(/^#/, '');
        var cut = text.indexOf('?');
        var path = cut === -1 ? text : text.slice(0, cut);
        var query = {};
        if (cut !== -1) {
            text.slice(cut + 1).split('&').forEach(function (pair) {
                if (!pair) {
                    return;
                }
                var parts = pair.split('=');
                try {
                    query[decodeURIComponent(parts[0])] = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
                } catch (error) {
                    // a broken escape: the pair is left out
                }
            });
        }
        var segments = path.split('/').filter(Boolean);
        if (segments[0] === 'login') {
            return { name: 'login' };
        }
        if (segments[0] === 'password') {
            return { name: 'password' };
        }
        if (segments[0] === 'estimates' && segments[1]) {
            return { name: 'detail', id: segments[1] };
        }
        return { name: 'list', query: query };
    }

    function buildHash(query) {
        var parts = [];
        Object.keys(query).forEach(function (key) {
            if (query[key] !== undefined && query[key] !== null && String(query[key]) !== '') {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])));
            }
        });
        return '#/estimates' + (parts.length > 0 ? '?' + parts.join('&') : '');
    }

    // ------------------------------------------------------------------------------------------

    function init() {
        var app = document.getElementById('app');
        var notice = document.getElementById('notice');
        var whoBox = document.getElementById('whoBox');
        var whoName = document.getElementById('whoName');
        var logoutButton = document.getElementById('logoutBtn');
        var labels = globalThis.AdminLabels;
        if (!app || !globalThis.AdminApi || !labels || typeof globalThis.fetch !== 'function') {
            return;
        }

        var api = globalThis.AdminApi.create(function (url, request) { return globalThis.fetch(url, request); });
        var me = null;
        var turn = 0; // a screen that was replaced meanwhile must not be drawn

        // ---- the frame
        function say(text, kind) {
            notice.textContent = text || '';
            notice.className = 'notice' + (text ? ' notice-' + (kind || 'info') : '');
            notice.hidden = !text;
        }

        function showWho() {
            whoBox.hidden = !me;
            whoName.textContent = me ? me.username + ' (' + labels.pick(labels.ROLE, me.role, me.role) + ')' : '';
        }

        function go(hash) {
            if (location.hash === hash) {
                render();
            } else {
                location.hash = hash;
            }
        }

        function frame(title, nodes) {
            clear(app);
            var heading = h('h2', { text: title, tabindex: '-1', id: 'screenTitle' });
            app.appendChild(heading);
            nodes.forEach(function (node) { app.appendChild(node); });
            heading.focus();
            return heading;
        }

        api.onSessionEnded(function () {
            me = null;
            showWho();
            go('#/login');
            say('로그인이 끝났어요. 다시 로그인해 주세요.', 'warning');
        });
        api.onPasswordChangeRequired(function () {
            go('#/password');
            say('먼저 비밀번호를 바꿔 주세요.', 'warning');
        });

        // ---- sign in
        function viewLogin() {
            var user = h('input', { id: 'loginUser', type: 'text', name: 'username', autocomplete: 'username', required: true });
            var pass = h('input', { id: 'loginPassword', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
            var error = h('p', { class: 'error', role: 'alert', hidden: true });
            var submit = h('button', { type: 'submit', class: 'primary', text: '로그인' });
            var form = h('form', { id: 'loginForm', class: 'card narrow', novalidate: true }, [
                labeled('아이디', user), labeled('비밀번호', pass), error, submit
            ]);
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                if (!user.value.trim() || !pass.value) {
                    error.textContent = '아이디와 비밀번호를 입력해 주세요.';
                    error.hidden = false;
                    return;
                }
                submit.disabled = true;
                error.hidden = true;
                api.login(user.value.trim(), pass.value).then(function (result) {
                    submit.disabled = false;
                    if (!result.ok) {
                        error.textContent = result.message;
                        error.hidden = false;
                        pass.value = '';
                        pass.focus();
                        return;
                    }
                    pass.value = '';
                    me = result.data;
                    showWho();
                    say('');
                    go(me && me.must_change_password ? '#/password' : '#/estimates');
                });
            });
            frame('로그인', [form]);
            user.focus();
        }

        // ---- change of the password (forced at the first sign-in, or by choice)
        function viewPassword() {
            var forced = !!(me && me.must_change_password);
            var current = h('input', { id: 'pwCurrent', type: 'password', autocomplete: 'current-password', required: true });
            var next = h('input', { id: 'pwNew', type: 'password', autocomplete: 'new-password', required: true });
            var again = h('input', { id: 'pwAgain', type: 'password', autocomplete: 'new-password', required: true });
            var error = h('div', { class: 'error', role: 'alert', hidden: true });
            var submit = h('button', { type: 'submit', class: 'primary', text: '비밀번호 바꾸기' });
            var form = h('form', { id: 'passwordForm', class: 'card narrow', novalidate: true }, [
                forced ? h('p', { class: 'hint', text: '처음 로그인했거나 임시 비밀번호예요. 새 비밀번호로 바꾼 뒤 다시 로그인해 주세요.' }) : null,
                labeled('지금 비밀번호', current),
                labeled('새 비밀번호', next, '12자 이상, 영문 대문자·소문자·숫자·기호 중 3가지 이상, 72바이트 이하'),
                labeled('새 비밀번호 확인', again),
                error, submit
            ]);
            function showError(messages) {
                clear(error);
                messages.forEach(function (text) { error.appendChild(h('p', { text: text })); });
                error.hidden = messages.length === 0;
            }
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                if (!current.value || !next.value) {
                    showError(['지금 비밀번호와 새 비밀번호를 입력해 주세요.']);
                    return;
                }
                if (next.value !== again.value) {
                    showError(['새 비밀번호와 확인이 달라요.']);
                    return;
                }
                submit.disabled = true;
                showError([]);
                api.changePassword(current.value, next.value).then(function (result) {
                    submit.disabled = false;
                    if (!result.ok) {
                        var lines = [result.message];
                        if (result.code === 'PASSWORD_POLICY_VIOLATION' && result.details && Array.isArray(result.details.violations)) {
                            var names = {
                                TOO_SHORT: '12자 이상이어야 해요.',
                                NOT_ENOUGH_CHARACTER_TYPES: '대문자·소문자·숫자·기호 중 3가지 이상을 써 주세요.',
                                CONTAINS_CONTROL_CHARACTERS: '사용할 수 없는 문자가 들어 있어요.',
                                MATCHES_ACCOUNT_INFO: '아이디나 이메일과 같거나 너무 비슷해요.',
                                MATCHES_DEFAULT_PASSWORD: '초기 비밀번호는 쓸 수 없어요.'
                            };
                            result.details.violations.forEach(function (code) { lines.push(labels.pick(names, code, code)); });
                        }
                        showError(lines);
                        return;
                    }
                    current.value = next.value = again.value = '';
                    // The server signed every session of this account out.
                    me = null;
                    showWho();
                    go('#/login');
                    say('비밀번호를 바꿨어요. 새 비밀번호로 다시 로그인해 주세요.', 'success');
                });
            });
            frame(forced ? '비밀번호를 바꿔 주세요' : '비밀번호 변경', [form]);
        }

        // ---- the list
        function readFilters(query) {
            var sort = SORTS.some(function (item) { return item[0] === query.sort_key; }) ? query.sort_key : SORTS[0][0];
            var page = parseInt(query.page, 10);
            return {
                status: labels.STATUS[query.status] ? query.status : '',
                category: labels.CATEGORY[query.category] ? query.category : '',
                q: (query.q || '').trim(),
                from: /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : '',
                to: /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : '',
                sort: sort,
                page: page > 0 ? page : 1
            };
        }

        function apiQuery(filters) {
            var parts = filters.sort.split(':');
            return {
                page: filters.page, limit: PAGE_SIZE, status: filters.status, category: filters.category, q: filters.q,
                created_from: filters.from, created_to: filters.to, sort: parts[0], order: parts[1]
            };
        }

        function hashOf(filters, page) {
            return buildHash({
                status: filters.status, category: filters.category, q: filters.q, from: filters.from, to: filters.to,
                sort_key: filters.sort === SORTS[0][0] ? '' : filters.sort, page: page > 1 ? page : ''
            });
        }

        function viewList(query) {
            var filters = readFilters(query);
            var mine = ++turn;

            function select(id, options, value) {
                var element = h('select', { id: id });
                options.forEach(function (option) {
                    var node = h('option', { value: option[0], text: option[1] });
                    if (option[0] === value) {
                        node.selected = true;
                    }
                    element.appendChild(node);
                });
                return element;
            }
            var status = select('fStatus', [['', '전체 상태']].concat(labels.STATUS_ORDER.map(function (key) { return [key, labels.STATUS[key]]; })), filters.status);
            var category = select('fCategory', [['', '전체 제품']].concat(Object.keys(labels.CATEGORY).map(function (key) { return [key, labels.CATEGORY[key]]; })), filters.category);
            var sort = select('fSort', SORTS, filters.sort);
            var search = h('input', { id: 'fSearch', type: 'search', placeholder: '접수번호, 이름, 회사, 이메일, 전화', value: filters.q });
            var from = h('input', { id: 'fFrom', type: 'date', value: filters.from });
            var to = h('input', { id: 'fTo', type: 'date', value: filters.to });

            var form = h('form', { id: 'filterForm', class: 'filters card', novalidate: true }, [
                labeled('상태', status), labeled('제품', category), labeled('검색', search),
                labeled('접수일 시작', from), labeled('접수일 끝', to), labeled('정렬', sort),
                h('div', { class: 'field actions' }, [
                    h('button', { type: 'submit', class: 'primary', text: '검색' }),
                    h('button', { type: 'button', id: 'filterReset', text: '초기화', on: { click: function () { go('#/estimates'); } } })
                ])
            ]);
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                go(hashOf({
                    status: status.value, category: category.value, q: search.value.trim(), from: from.value, to: to.value, sort: sort.value
                }, 1));
            });

            var result = h('div', { id: 'listResult', 'aria-live': 'polite' }, [h('p', { class: 'hint', text: '불러오는 중…' })]);
            frame('견적 접수 목록', [form, result]);

            api.list(apiQuery(filters)).then(function (answer) {
                if (mine !== turn) {
                    return;
                }
                clear(result);
                if (!answer.ok) {
                    result.appendChild(h('p', { class: 'error', role: 'alert', text: answer.message }));
                    return;
                }
                var items = answer.data || [];
                var pagination = answer.pagination || { page: 1, total: items.length, total_pages: 1 };
                if (items.length === 0) {
                    result.appendChild(h('p', { class: 'empty', text: '조건에 맞는 접수가 없어요.' }));
                    return;
                }
                var body = h('tbody');
                items.forEach(function (item) {
                    body.appendChild(h('tr', {}, [
                        h('td', {}, [h('a', { href: '#/estimates/' + encodeURIComponent(item.id), text: item.receipt_id })].concat(
                            (item.request_kind === 'detailed' ? [h('span', { class: 'tag tag-detailed', text: '상세견적' })] : []).concat(
                                item.open_inquiries > 0 ? [h('span', { class: 'tag tag-inquiry', text: '문의 ' + item.open_inquiries })] : []
                            )
                        )),
                        h('td', { text: labels.formatDateTime(item.created_at) }),
                        h('td', {}, [badge(item.status)]),
                        h('td', { text: labels.pick(labels.CATEGORY, item.category, item.category) }),
                        h('td', { text: item.customer_name || '-' }),
                        h('td', { text: item.company_name || '-' }),
                        h('td', { text: item.customer_type ? labels.pick(labels.CUSTOMER_TYPE, item.customer_type, item.customer_type) : '-' }),
                        h('td', { class: 'num', text: String(item.file_count || 0) })
                    ]));
                });
                var head = h('tr', {}, ['접수번호', '접수 일시', '상태', '제품', '고객', '회사·브랜드', '고객 유형', '첨부'].map(function (name) {
                    return h('th', { scope: 'col', text: name });
                }));
                result.appendChild(h('div', { class: 'table-wrap' }, [
                    h('table', { class: 'list' }, [h('caption', { class: 'sr-only', text: '견적 접수 목록' }), h('thead', {}, [head]), body])
                ]));

                var page = pagination.page;
                var last = Math.max(1, pagination.total_pages || 1);
                var prev = h('button', { type: 'button', id: 'pagePrev', text: '이전', disabled: page <= 1 });
                var next = h('button', { type: 'button', id: 'pageNext', text: '다음', disabled: page >= last });
                prev.addEventListener('click', function () { go(hashOf(filters, page - 1)); });
                next.addEventListener('click', function () { go(hashOf(filters, page + 1)); });
                result.appendChild(h('nav', { class: 'pager', 'aria-label': '쪽 이동' }, [
                    prev, h('span', { id: 'pageInfo', text: page + ' / ' + last + ' 쪽 · 총 ' + pagination.total + '건' }), next
                ]));
            });
        }

        // ---- one request
        function specRows(spec) {
            var order = [
                'frame_type', 'shoe_type', 'product_type', 'product_description', 'material', 'lens_type', 'frame_color',
                'lens_color', 'color', 'size', 'size_range', 'sizes', 'design', 'customization', 'quantity', 'delivery_date',
                'additional_info', 'special_requirements'
            ];
            var rows = [];
            var done = {};
            function add(key) {
                if (done[key] || key === 'ai_preview' || !Object.prototype.hasOwnProperty.call(spec, key)) {
                    return;
                }
                done[key] = true;
                var value = labels.specValue(key, spec[key]);
                if (value !== '') {
                    rows.push([labels.pick(labels.SPEC_KEY, key, key), value, key === 'additional_info' || key === 'special_requirements' || key === 'product_description' ? 'long' : '']);
                }
            }
            order.forEach(add);
            Object.keys(spec).sort().forEach(add);
            return rows;
        }

        function sectionAi(preview) {
            var ai = labels.AI;
            var analysis = preview.analysis || null;
            var price = preview.price || null;
            var blocks = [
                h('p', { class: 'hint', text: '고객이 AI 견적을 시작했을 때 화면에 보인 내용을 고객의 브라우저가 보낸 기록이에요. 견적이 아니고, 사실로 확인된 값도 아니에요. 담당자는 위의 제품 사양과 규칙에 따른 가격으로 판단해 주세요.' })
            ];
            if (price && price.unit_price && price.total_price) {
                blocks.push(definitionList([
                    ['예상 개당 가격', '약 ' + labels.formatWon(price.unit_price.min) + ' ~ ' + labels.formatWon(price.unit_price.max)],
                    ['예상 총액', '약 ' + labels.formatWon(price.total_price.min) + ' ~ ' + labels.formatWon(price.total_price.max) + (price.quantity ? ' (' + Number(price.quantity).toLocaleString('ko-KR') + '개 기준)' : '')]
                ]));
            }
            if (analysis) {
                blocks.push(definitionList([
                    ['AI가 본 재질', analysis.frame_material ? labels.pick(ai.frame_material, analysis.frame_material, analysis.frame_material) : ''],
                    ['AI가 본 렌즈', analysis.lens_type ? labels.pick(ai.lens_type, analysis.lens_type, analysis.lens_type) : ''],
                    ['프레임 형태', analysis.frame_shape], ['프레임 색상', analysis.frame_color],
                    ['확신도', analysis.confidence ? labels.pick(ai.confidence, analysis.confidence, analysis.confidence) : ''],
                    ['제작 복잡도', analysis.complexity ? labels.pick(ai.complexity, analysis.complexity, analysis.complexity) : ''],
                    ['종합 분석', analysis.overview, 'long'],
                    ['프레임', analysis.details && analysis.details.frame], ['렌즈', analysis.details && analysis.details.lens],
                    ['장식', analysis.details && analysis.details.decoration]
                ]));
                [['주요 비용 요인', analysis.cost_factors], ['권고사항', analysis.recommendations]].forEach(function (pair) {
                    if (Array.isArray(pair[1]) && pair[1].length > 0) {
                        blocks.push(h('h4', { text: pair[0] }));
                        blocks.push(h('ul', {}, pair[1].map(function (text) { return h('li', { text: String(text) }); })));
                    }
                });
            }
            return blocks;
        }


        // ------------------------------------------------------------------------------------------
        // The detailed quote of one request: the staff write it here and publish it; the customer then
        // reads it on the site. The amounts are counted by the server; the screen only shows the sum as
        // the staff type. Everything is put in with textContent.

        var QUOTE_CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY'];
        var QUOTE_FIELD_NAMES = {
            items: '항목', fx_currency: '환율 통화', fx_rate: '적용 환율', valid_until: '견적 유효기간',
            lead_time: '납기 예상', customer_note: '고객 안내 메모', name: '이름', quantity: '수량', unit_price: '단가'
        };

        function quoteFieldName(field) {
            var item = /^items\[(\d+)\]\.(\w+)$/.exec(field);
            if (item) {
                return '항목 ' + (Number(item[1]) + 1) + ' ' + (QUOTE_FIELD_NAMES[item[2]] || item[2]);
            }
            var whole = /^items\[(\d+)\]$/.exec(field);
            if (whole) {
                return '항목 ' + (Number(whole[1]) + 1);
            }
            return QUOTE_FIELD_NAMES[field] || field;
        }

        function quoteStateText(quote) {
            if (!quote) {
                return '아직 작성하지 않았어요.';
            }
            if (quote.version === 0) {
                return '임시저장됨 · 고객에게는 아직 보이지 않아요.';
            }
            if (quote.has_unpublished_changes) {
                return 'v' + quote.version + ' 게시됨 · 게시하지 않은 변경이 있어요. 고객에게는 v' + quote.version + '이 보여요.';
            }
            return 'v' + quote.version + ' 게시됨 (최신) · 고객에게 보여요.';
        }

        function loadQuote(id, card) {
            var mine = turn;
            api.quote(id).then(function (answer) {
                if (mine !== turn || !card.isConnected) {
                    return;
                }
                while (card.childNodes.length > 1) {
                    card.removeChild(card.lastChild);
                }
                if (!answer.ok) {
                    card.appendChild(h('p', { class: 'error', role: 'alert', text: answer.message }));
                    return;
                }
                drawQuote(id, card, answer.data);
            });
        }

        function drawQuote(id, card, context) {
            var quote = context.quote;
            if (!context.has_account) {
                card.appendChild(h('p', { class: 'hint', text: '이 접수는 로그인하지 않고 보낸 접수라, 고객이 사이트에서 견적을 볼 수 없어요. 상세견적은 회원이 요청한 접수에만 쓸 수 있어요. 견적은 고객에게 이메일이나 전화로 따로 전해 주세요.' }));
                return;
            }

            card.appendChild(h('p', { id: 'quoteState', class: 'quote-state', text: quoteStateText(quote) }));
            card.appendChild(h('p', { class: 'hint', text: '여기 적은 내용은 게시하면 고객에게 그대로 보여요. 원가, 공장 정보 같은 내부 내용은 쓰지 말고 아래 내부 메모에 남겨 주세요.' }));

            var editSeq = quote ? quote.edit_seq : null; // the save this screen was made from
            var rows = h('tbody', { id: 'quoteRows' });
            var totalCell = h('strong', { id: 'quoteTotal' });
            var formError = h('p', { id: 'quoteError', class: 'error', role: 'alert', hidden: true });
            var usedDefault = false;
            var dirty = !quote;

            function number(value) {
                var text = String(value).trim();
                return /^\d+$/.test(text) ? Number(text) : NaN;
            }

            function recount() {
                var total = 0;
                Array.prototype.forEach.call(rows.children, function (row) {
                    var quantity = number(row.querySelector('.q-quantity').value);
                    var price = number(row.querySelector('.q-price').value);
                    var amount = isFinite(quantity) && isFinite(price) ? quantity * price : null;
                    row.querySelector('.q-amount').textContent = amount === null ? '-' : labels.formatWon(amount);
                    total += amount || 0;
                });
                totalCell.textContent = labels.formatWon(total);
            }

            function markDirty() {
                dirty = true;
                recount();
            }

            function addRow(item) {
                var name = h('input', { type: 'text', class: 'q-name', maxlength: '200', 'aria-label': '항목 이름', value: item ? item.name : '' });
                var quantity = h('input', { type: 'number', class: 'q-quantity', min: '1', step: '1', inputmode: 'numeric', 'aria-label': '수량', value: item ? String(item.quantity) : '' });
                var price = h('input', { type: 'number', class: 'q-price', min: '0', step: '1', inputmode: 'numeric', 'aria-label': '단가(원)', value: item ? String(item.unit_price) : '' });
                var remove = h('button', { type: 'button', class: 'q-remove', text: '삭제', 'aria-label': '이 항목 삭제' });
                var row = h('tr', {}, [
                    h('td', {}, [name]), h('td', {}, [quantity]), h('td', {}, [price]),
                    h('td', { class: 'q-amount num', text: '-' }), h('td', {}, [remove])
                ]);
                [name, quantity, price].forEach(function (input) { input.addEventListener('input', markDirty); });
                remove.addEventListener('click', function () {
                    rows.removeChild(row);
                    markDirty();
                });
                rows.appendChild(row);
            }

            (quote && quote.items.length > 0 ? quote.items : [null]).forEach(addRow);

            var addButton = h('button', { type: 'button', id: 'quoteAddRow', text: '+ 항목 추가' });
            addButton.addEventListener('click', function () {
                if (rows.children.length >= 30) {
                    return;
                }
                addRow(null);
                markDirty();
            });

            var currency = h('select', { id: 'quoteCurrency' }, [h('option', { value: '', text: '없음' })].concat(
                QUOTE_CURRENCIES.map(function (code) { return h('option', { value: code, text: code }); })
            ));
            currency.value = quote && quote.fx_currency ? quote.fx_currency : '';
            var rate = h('input', { id: 'quoteRate', type: 'number', step: '0.0001', min: '0', inputmode: 'decimal', value: quote && quote.fx_rate ? String(quote.fx_rate) : '' });
            var validUntil = h('input', { id: 'quoteValidUntil', type: 'date', value: quote && quote.valid_until ? quote.valid_until : '' });
            var leadTime = h('input', { id: 'quoteLeadTime', type: 'text', maxlength: '200', value: quote && quote.lead_time ? quote.lead_time : '' });

            // The staff member the customer can ask: shown with the quote. It starts from what this staff member
            // used last time (the screen has to save it before publishing when it comes from there).
            var defaults = context.contact_defaults || {};
            function contactValue(own, fallback) {
                if (quote && quote[own]) {
                    return quote[own];
                }
                if (fallback) {
                    usedDefault = true;
                }
                return fallback || '';
            }
            var contactName = h('input', { id: 'quoteContactName', type: 'text', maxlength: '50', autocomplete: 'off', value: contactValue('contact_name', defaults.name) });
            var contactEmail = h('input', { id: 'quoteContactEmail', type: 'email', maxlength: '100', autocomplete: 'off', value: contactValue('contact_email', defaults.email) });
            var contactPhone = h('input', { id: 'quoteContactPhone', type: 'tel', maxlength: '20', autocomplete: 'off', value: contactValue('contact_phone', defaults.phone) });
            dirty = dirty || usedDefault;
            var note = h('textarea', { id: 'quoteNote', rows: '4', maxlength: '2000' });
            note.value = quote && quote.customer_note ? quote.customer_note : '';
            [currency, rate, validUntil, leadTime, note, contactName, contactEmail, contactPhone].forEach(function (control) {
                control.addEventListener('input', markDirty);
                control.addEventListener('change', markDirty);
            });

            var saveButton = h('button', { type: 'submit', id: 'quoteSave', text: '임시저장' });
            var publishButton = h('button', { type: 'button', id: 'quotePublish', class: 'primary', text: '고객에게 게시' });
            var confirmBox = h('div', { id: 'quoteConfirm', class: 'quote-confirm', role: 'alert', hidden: true });
            var form = h('form', { id: 'quoteForm', novalidate: true }, [
                h('div', { class: 'table-wrap' }, [h('table', { class: 'list quote-items' }, [
                    h('thead', {}, [h('tr', {}, ['항목', '수량', '단가(원)', '금액', ''].map(function (name) { return h('th', { scope: 'col', text: name }); }))]),
                    rows,
                    h('tfoot', {}, [h('tr', {}, [h('th', { scope: 'row', colspan: '3', text: '합계' }), h('td', { class: 'num' }, [totalCell]), h('td')])])
                ])]),
                addButton,
                h('p', { class: 'hint', text: '금액과 합계는 저장할 때 서버가 수량 × 단가로 다시 계산해요. 원 단위 정수만 쓸 수 있어요.' }),
                h('div', { class: 'quote-grid' }, [
                    labeled('적용 환율 통화', currency), labeled('적용 환율 (1 통화 = ? 원)', rate), labeled('견적 유효기간', validUntil),
                    labeled('납기 예상', leadTime, '예: 주문 후 약 6주')
                ]),
                labeled('고객 안내 메모', note, '고객에게 그대로 보여요. (2,000자까지)'),
                h('h4', { text: '담당자 연락처' }),
                h('p', { class: 'hint', text: '견적과 함께 고객에게 보여요. 고객이 질문하거나 전화를 요청하면 이 담당자가 답해요. 게시하려면 세 가지 모두 필요해요.' }),
                h('div', { class: 'quote-grid' }, [labeled('이름', contactName), labeled('이메일', contactEmail), labeled('전화', contactPhone)]),
                formError,
                h('div', { class: 'actions' }, [saveButton, publishButton]),
                confirmBox
            ]);
            card.appendChild(form);
            recount();

            // What the form holds, as the API wants it; or the message of what is wrong.
            function collect() {
                var items = [];
                var problem = '';
                Array.prototype.forEach.call(rows.children, function (row, index) {
                    var name = row.querySelector('.q-name').value.trim();
                    var quantity = number(row.querySelector('.q-quantity').value);
                    var price = number(row.querySelector('.q-price').value);
                    if (!name) {
                        problem = problem || '항목 ' + (index + 1) + '의 이름을 적어 주세요.';
                    } else if (!isFinite(quantity) || quantity < 1) {
                        problem = problem || '항목 ' + (index + 1) + '의 수량은 1 이상의 정수로 적어 주세요.';
                    } else if (!isFinite(price)) {
                        problem = problem || '항목 ' + (index + 1) + '의 단가는 0 이상의 정수(원)로 적어 주세요.';
                    }
                    items.push({ name: name, quantity: quantity, unit_price: price });
                });
                if (items.length === 0) {
                    problem = '항목을 1개 이상 넣어 주세요.';
                }
                var body = { items: items };
                if (currency.value || rate.value.trim()) {
                    if (!currency.value || !rate.value.trim() || !(Number(rate.value) > 0)) {
                        problem = problem || '환율은 통화와 환율을 함께 적어 주세요.';
                    } else {
                        body.fx_currency = currency.value;
                        body.fx_rate = Number(rate.value);
                    }
                }
                if (validUntil.value) {
                    body.valid_until = validUntil.value;
                }
                if (leadTime.value.trim()) {
                    body.lead_time = leadTime.value.trim();
                }
                if (note.value.trim()) {
                    body.customer_note = note.value.trim();
                }
                if (contactName.value.trim()) {
                    body.contact_name = contactName.value.trim();
                }
                if (contactEmail.value.trim()) {
                    body.contact_email = contactEmail.value.trim();
                }
                if (contactPhone.value.trim()) {
                    body.contact_phone = contactPhone.value.trim();
                }
                if (editSeq !== null) {
                    body.expected_edit_seq = editSeq;
                }
                return { body: body, problem: problem };
            }

            function showProblem(result) {
                var text = result.message;
                if (Array.isArray(result.details) && result.details.length > 0) {
                    text += ' (' + result.details.map(function (detail) { return quoteFieldName(detail.field); }).join(', ') + ')';
                }
                formError.textContent = text;
                formError.hidden = false;
                if (result.code === 'QUOTE_CONFLICT') {
                    say(result.message, 'warning');
                }
            }

            function busy(on) {
                saveButton.disabled = on;
                publishButton.disabled = on;
            }

            // Saves what is on the screen; answers with the saved quote, or null after showing why not.
            function save() {
                formError.hidden = true;
                var collected = collect();
                if (collected.problem) {
                    formError.textContent = collected.problem;
                    formError.hidden = false;
                    return Promise.resolve(null);
                }
                return api.saveQuote(id, collected.body).then(function (result) {
                    if (!result.ok) {
                        showProblem(result);
                        return null;
                    }
                    editSeq = result.data.edit_seq;
                    dirty = false;
                    return result.data;
                });
            }

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                busy(true);
                confirmBox.hidden = true;
                save().then(function (saved) {
                    busy(false);
                    if (saved) {
                        say('견적을 임시저장했어요. 게시하기 전에는 고객에게 보이지 않아요.', 'success');
                        loadQuote(id, card);
                    }
                });
            });

            // Publishing is asked twice: it is the moment the customer can see it.
            publishButton.addEventListener('click', function () {
                formError.hidden = true;
                var collected = collect();
                if (collected.problem) {
                    formError.textContent = collected.problem;
                    formError.hidden = false;
                    return;
                }
                if (!collected.body.contact_name || !collected.body.contact_email || !collected.body.contact_phone) {
                    formError.textContent = '고객이 연락할 담당자의 이름, 이메일, 전화를 모두 적어 주세요.';
                    formError.hidden = false;
                    return;
                }
                clear(confirmBox);
                var yes = h('button', { type: 'button', id: 'quotePublishYes', class: 'primary', text: '게시하기' });
                var no = h('button', { type: 'button', id: 'quotePublishNo', text: '취소' });
                confirmBox.appendChild(h('p', { text: '게시하면 고객이 내 견적에서 이 견적을 바로 볼 수 있고, 고객에게 이메일로 알려요. 합계는 ' + totalCell.textContent + '이에요. 게시할까요?' }));
                confirmBox.appendChild(h('div', { class: 'actions' }, [yes, no]));
                confirmBox.hidden = false;
                no.addEventListener('click', function () { confirmBox.hidden = true; });
                yes.addEventListener('click', function () {
                    busy(true);
                    yes.disabled = true;
                    // What is on the screen is saved first when it differs from the saved copy.
                    var ready = dirty || !quote ? save() : Promise.resolve(quote);
                    ready.then(function (saved) {
                        if (!saved) {
                            busy(false);
                            yes.disabled = false;
                            return null;
                        }
                        return api.publishQuote(id, saved.edit_seq).then(function (result) {
                            busy(false);
                            if (!result.ok) {
                                yes.disabled = false;
                                showProblem(result);
                                if (result.code === 'NOTHING_TO_PUBLISH') {
                                    // Somebody published it meanwhile: the section is drawn again, so the notice carries the words.
                                    say(result.message, 'warning');
                                    loadQuote(id, card);
                                }
                                return;
                            }
                            say('견적을 고객에게 게시했어요 (v' + result.data.version + '). ' +
                                (result.data.notification_queued ? '고객에게 이메일로 알려요. ' : '고객에게 보낼 이메일 알림은 만들어지지 않았어요. ') +
                                '접수 상태를 바꾸려면 아래 상태 변경을 써 주세요.', 'success');
                            loadQuote(id, card);
                        });
                    });
                });
            });

            // The publications so far.
            var revisions = context.revisions || [];
            if (revisions.length > 0) {
                card.appendChild(h('h4', { text: '게시 이력' }));
                card.appendChild(h('ul', { class: 'quote-revisions' }, revisions.map(function (revision) {
                    return h('li', { text: 'v' + revision.version + ' · ' + labels.formatDateTime(revision.published_at) + (revision.published_by ? ' · ' + revision.published_by.username : '') });
                })));
            }
        }


        // ------------------------------------------------------------------------------------------
        // What the customer asked about the published quote: short questions (the staff answer in
        // writing) and requests for a consultation (the staff phone the customer).

        var INQUIRY_ANSWER_MAX = 500;
        var INQUIRY_NOTE_MAX = 300;

        function inquiryStatusText(inquiry) {
            if (inquiry.status === 'open') {
                return inquiry.kind === 'consultation' ? '전화 대기' : '답변 대기';
            }
            return inquiry.kind === 'consultation' ? '통화 완료' : '답변 완료';
        }

        function loadInquiries(id, card, heading) {
            var mine = turn;
            api.inquiries(id).then(function (answer) {
                if (mine !== turn || !card.isConnected) {
                    return;
                }
                while (card.childNodes.length > 1) {
                    card.removeChild(card.lastChild);
                }
                if (!answer.ok) {
                    card.appendChild(h('p', { class: 'error', role: 'alert', text: answer.message }));
                    return;
                }
                var items = answer.data || [];
                var open = items.filter(function (item) { return item.status === 'open'; }).length;
                heading.textContent = '고객 문의 (' + items.length + (open > 0 ? ' · 처리 대기 ' + open : '') + ')';
                if (items.length === 0) {
                    card.appendChild(h('p', { class: 'empty', text: '고객이 남긴 질문이나 심층상담 요청이 아직 없어요.' }));
                    return;
                }
                var list = h('ul', { class: 'inquiries' });
                items.forEach(function (item) { list.appendChild(drawInquiry(id, card, heading, item)); });
                card.appendChild(list);
            });
        }

        function drawInquiry(id, card, heading, inquiry) {
            var isConsultation = inquiry.kind === 'consultation';
            var top = h('p', { class: 'inquiry-top' }, [
                h('span', { class: 'badge badge-' + (inquiry.status === 'open' ? 'new' : 'done'), text: inquiryStatusText(inquiry) }),
                h('strong', { text: isConsultation ? '심층상담 요청' : '질문' }),
                h('span', { class: 'muted', text: labels.formatDateTime(inquiry.created_at) + ' · 견적 v' + inquiry.quote_version + '을 보고 남김' })
            ]);
            var body = h('li', { class: 'inquiry' + (inquiry.status === 'open' ? ' inquiry-open' : '') }, [top]);

            if (isConsultation) {
                body.appendChild(definitionList([
                    ['전화할 번호', inquiry.phone, 'inquiry-phone'],
                    ['편한 시간', labels.pick(labels.PREFERRED_TIME, inquiry.preferred_time || 'any', inquiry.preferred_time)],
                    ['고객 메모', inquiry.body, 'long']
                ]));
            } else {
                body.appendChild(h('p', { class: 'long inquiry-text', text: inquiry.body }));
            }

            if (inquiry.status !== 'open') {
                var who = (inquiry.handled_by ? inquiry.handled_by.username : '') + (inquiry.handled_at ? ' · ' + labels.formatDateTime(inquiry.handled_at) : '');
                if (inquiry.answer) {
                    body.appendChild(h('p', { class: 'muted', text: (isConsultation ? '통화 메모' : '답변') + ' · ' + who }));
                    body.appendChild(h('p', { class: 'long inquiry-answer', text: inquiry.answer }));
                } else {
                    body.appendChild(h('p', { class: 'muted', text: who }));
                }
                return body;
            }

            // Open: the staff answer, or say that they phoned.
            var field = h(isConsultation ? 'input' : 'textarea', Object.assign(
                { id: 'inquiryAnswer-' + inquiry.id, maxlength: String(isConsultation ? INQUIRY_NOTE_MAX : INQUIRY_ANSWER_MAX) },
                isConsultation ? { type: 'text' } : { rows: '3' }
            ));
            var error = h('p', { class: 'error', role: 'alert', hidden: true });
            var button = h('button', {
                type: 'submit', class: 'primary', text: isConsultation ? '통화 완료로 표시' : '답변 남기기'
            });
            var form = h('form', { class: 'inquiry-form', novalidate: true }, [
                labeled(
                    isConsultation ? '통화 메모 (선택)' : '답변',
                    field,
                    isConsultation
                        ? '고객에게 전화한 뒤 눌러 주세요. 메모는 고객에게도 보여요. (' + INQUIRY_NOTE_MAX + '자까지)'
                        : '고객이 "내 견적"에서 보고, 이메일로도 알림이 가요. (' + INQUIRY_ANSWER_MAX + '자까지)'
                ),
                error,
                button
            ]);
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var text = field.value.trim();
                if (!isConsultation && !text) {
                    error.textContent = '답변을 적어 주세요.';
                    error.hidden = false;
                    field.focus();
                    return;
                }
                button.disabled = true;
                error.hidden = true;
                var call = isConsultation ? api.doneInquiry(id, inquiry.id, text) : api.answerInquiry(id, inquiry.id, text);
                call.then(function (result) {
                    button.disabled = false;
                    if (!result.ok) {
                        error.textContent = result.message;
                        error.hidden = false;
                        if (result.code === 'ALREADY_HANDLED') {
                            loadInquiries(id, card, heading);
                        }
                        return;
                    }
                    say(isConsultation ? '통화 완료로 표시했어요.' : '답변을 남겼어요. 고객에게 이메일로 알려요.', 'success');
                    loadInquiries(id, card, heading);
                });
            });
            body.appendChild(form);
            return body;
        }

        function viewDetail(id) {
            var mine = ++turn;
            var holder = h('div', { id: 'detailBody', 'aria-live': 'polite' }, [h('p', { class: 'hint', text: '불러오는 중…' })]);
            frame('접수 상세', [h('p', {}, [h('a', { href: '#/estimates', class: 'back', text: '← 목록으로' })]), holder]);

            function load() {
                return api.detail(id).then(function (answer) {
                    if (mine !== turn) {
                        return;
                    }
                    clear(holder);
                    if (!answer.ok) {
                        holder.appendChild(h('p', { class: 'error', role: 'alert', text: answer.message }));
                        return;
                    }
                    draw(answer.data);
                });
            }

            function draw(data) {
                var e = data.estimate;
                var spec = e.specification_json && typeof e.specification_json === 'object' ? e.specification_json : {};
                var title = document.getElementById('screenTitle');
                title.textContent = '접수 ' + e.receipt_id;

                holder.appendChild(h('div', { class: 'summary' }, [
                    badge(e.status),
                    h('span', { text: labels.pick(labels.CATEGORY, e.category, e.category) }),
                    h('span', { class: 'muted', text: '접수 ' + labels.formatDateTime(e.created_at) + ' · 변경 ' + labels.formatDateTime(e.updated_at) })
                ]));

                function section(name, nodes, id) {
                    var element = h('section', { class: 'card', 'aria-labelledby': id }, [h('h3', { id: id, text: name })]);
                    nodes.forEach(function (node) { element.appendChild(node); });
                    holder.appendChild(element);
                    return element;
                }

                section('고객 정보', [definitionList([
                    ['이름', e.customer_name], ['회사·브랜드', e.company_name], ['이메일', e.customer_email], ['전화', e.customer_phone],
                    ['요청 종류', labels.pick(labels.REQUEST_KIND, e.request_kind || 'simple', e.request_kind) + (e.has_account ? ' · 회원 계정' : ' · 비회원')],
                    ['고객 유형', e.customer_type ? labels.pick(labels.CUSTOMER_TYPE, e.customer_type, e.customer_type) : '확인 불가 (기록 이전 접수)'],
                    ['개인정보 동의', e.privacy_consent_at ? labels.formatDateTime(e.privacy_consent_at) + ' · 안내문 ' + (e.privacy_consent_version || '') : '기록 없음']
                ])], 'secCustomer');

                var specNodes = [definitionList(specRows(spec))];
                specNodes.push(h('details', { class: 'raw' }, [h('summary', { text: '원본 데이터 (JSON)' }), h('pre', { text: JSON.stringify(e.specification_json, null, 2) })]));
                section('제품 사양', specNodes, 'secSpec');

                if (spec.ai_preview && typeof spec.ai_preview === 'object') {
                    section('고객 화면에 보인 AI 분석 (참고용)', sectionAi(spec.ai_preview), 'secAi');
                }

                // files
                var files = data.files || [];
                var fileNodes = [];
                if (files.length === 0) {
                    fileNodes.push(h('p', { class: 'empty', text: '첨부 파일이 없어요.' }));
                } else {
                    var fileBody = h('tbody');
                    files.forEach(function (file) {
                        fileBody.appendChild(h('tr', {}, [
                            h('td', { text: file.filename }), h('td', { text: labels.formatBytes(file.file_size) }), h('td', { text: file.mime_type }),
                            h('td', { text: labels.pick(labels.FILE_STATUS, file.file_status, file.file_status) + ' · 바이러스 검사 ' + labels.pick(labels.SCAN_STATUS, file.virus_scan_status, file.virus_scan_status) }),
                            h('td', { text: labels.formatDateTime(file.uploaded_at) })
                        ]));
                    });
                    fileNodes.push(h('div', { class: 'table-wrap' }, [h('table', { class: 'list' }, [
                        h('thead', {}, [h('tr', {}, ['파일명', '크기', '형식', '상태', '올린 시각'].map(function (name) { return h('th', { scope: 'col', text: name }); }))]),
                        fileBody
                    ])]));
                    fileNodes.push(h('p', { class: 'hint', text: '첨부 파일 열람은 바이러스 검사를 도입하기 전이라 막혀 있어요. 파일이 필요하면 고객에게 이메일로 요청해 주세요.' }));
                }
                section('첨부 파일 (' + files.length + ')', fileNodes, 'secFiles');

                // ---- the detailed quote (for the customer to read on the site)
                var quoteCard = section('담당자 상세견적', [h('p', { class: 'hint', text: '불러오는 중…' })], 'secQuote');
                loadQuote(id, quoteCard);

                // ---- what the customer asked about it
                var inquiryCard = section('고객 문의', [h('p', { class: 'hint', text: '불러오는 중…' })], 'secInquiries');
                loadInquiries(id, inquiryCard, inquiryCard.querySelector('h3'));

                // status change
                var allowed = data.allowed_transitions || [];
                var statusNodes = [h('p', {}, ['지금 상태: ', badge(e.status)])];
                if (allowed.length === 0) {
                    statusNodes.push(h('p', { class: 'hint', text: '지금 상태에서 바꿀 수 있는 다음 상태가 없어요.' }));
                } else {
                    var target = h('select', { id: 'statusTarget' });
                    allowed.forEach(function (item) {
                        target.appendChild(h('option', { value: item.to, text: labels.statusLabel(item.to) + (item.reason_required ? ' (사유 필요)' : '') }));
                    });
                    var reason = h('textarea', { id: 'statusReason', rows: '3', maxlength: String(REASON_MAX) });
                    var reasonHint = h('p', { class: 'hint', id: 'statusReasonHint' });
                    var statusError = h('p', { class: 'error', role: 'alert', hidden: true });
                    var apply = h('button', { type: 'submit', class: 'primary', text: '상태 바꾸기' });
                    function needsReason() {
                        return allowed.some(function (item) { return item.to === target.value && item.reason_required; });
                    }
                    function syncReason() {
                        reasonHint.textContent = needsReason()
                            ? '이 상태로 바꾸려면 사유가 꼭 필요해요. (' + REASON_MAX + '자까지)'
                            : '사유는 선택이에요. (' + REASON_MAX + '자까지)';
                    }
                    target.addEventListener('change', syncReason);
                    syncReason();
                    var statusForm = h('form', { id: 'statusForm', novalidate: true }, [
                        labeled('바꿀 상태', target), labeled('사유', reason), reasonHint, statusError, apply
                    ]);
                    statusForm.addEventListener('submit', function (event) {
                        event.preventDefault();
                        var text = reason.value.trim();
                        if (needsReason() && !text) {
                            statusError.textContent = globalThis.AdminApi.messageFor('REASON_REQUIRED');
                            statusError.hidden = false;
                            reason.focus();
                            return;
                        }
                        apply.disabled = true;
                        statusError.hidden = true;
                        var body = { to_status: target.value, expected_status: e.status };
                        if (text) {
                            body.reason = text;
                        }
                        api.changeStatus(id, body).then(function (result) {
                            apply.disabled = false;
                            if (result.ok) {
                                say('상태를 "' + labels.statusLabel(body.to_status) + '"(으)로 바꿨어요.', 'success');
                                clear(holder);
                                holder.appendChild(h('p', { class: 'hint', text: '불러오는 중…' }));
                                load();
                                return;
                            }
                            statusError.textContent = result.message;
                            statusError.hidden = false;
                            if (result.code === 'STATUS_CONFLICT') {
                                say(result.message, 'warning');
                                clear(holder);
                                load();
                            }
                        });
                    });
                    statusNodes.push(statusForm);
                }
                section('상태 변경', statusNodes, 'secStatus');

                // history
                var history = data.status_history || [];
                var historyNodes = [];
                if (history.length === 0) {
                    historyNodes.push(h('p', { class: 'empty', text: '아직 상태 변경 기록이 없어요.' }));
                } else {
                    var historyBody = h('tbody');
                    history.forEach(function (entry) {
                        historyBody.appendChild(h('tr', {}, [
                            h('td', { text: labels.formatDateTime(entry.created_at) }),
                            h('td', { text: (entry.old_status ? labels.statusLabel(entry.old_status) : '(처음)') + ' → ' + labels.statusLabel(entry.new_status) }),
                            h('td', { text: entry.changed_by ? entry.changed_by.username : '시스템' }),
                            h('td', { class: 'long', text: entry.reason || '' })
                        ]));
                    });
                    historyNodes.push(h('div', { class: 'table-wrap' }, [h('table', { class: 'list' }, [
                        h('thead', {}, [h('tr', {}, ['시각', '변경', '담당자', '사유'].map(function (name) { return h('th', { scope: 'col', text: name }); }))]),
                        historyBody
                    ])]));
                }
                section('상태 이력', historyNodes, 'secHistory');

                // memos
                var memoText = h('textarea', { id: 'memoText', rows: '3', maxlength: String(MEMO_MAX) });
                var memoError = h('p', { class: 'error', role: 'alert', hidden: true });
                var memoAdd = h('button', { type: 'submit', class: 'primary', text: '메모 남기기' });
                var memoForm = h('form', { id: 'memoForm', novalidate: true }, [
                    labeled('내부 메모', memoText, '고객에게는 보이지 않아요. 한 번 남기면 고치거나 지울 수 없어요. (' + MEMO_MAX + '자까지)'), memoError, memoAdd
                ]);
                memoForm.addEventListener('submit', function (event) {
                    event.preventDefault();
                    var text = memoText.value.trim();
                    if (!text) {
                        memoError.textContent = '메모 내용을 적어 주세요.';
                        memoError.hidden = false;
                        memoText.focus();
                        return;
                    }
                    memoAdd.disabled = true;
                    memoError.hidden = true;
                    api.addMemo(id, text).then(function (result) {
                        memoAdd.disabled = false;
                        if (!result.ok) {
                            memoError.textContent = result.message;
                            memoError.hidden = false;
                            return;
                        }
                        say('메모를 남겼어요.', 'success');
                        clear(holder);
                        load();
                    });
                });
                var memos = data.memos || [];
                var memoList = h('ul', { class: 'memos' });
                memos.forEach(function (memo) {
                    memoList.appendChild(h('li', {}, [
                        h('p', { class: 'muted', text: (memo.author ? memo.author.username : '') + ' · ' + labels.formatDateTime(memo.created_at) }),
                        h('p', { class: 'long', text: memo.content })
                    ]));
                });
                section('내부 메모 (' + memos.length + ')', [memoForm, memos.length === 0 ? h('p', { class: 'empty', text: '아직 메모가 없어요.' }) : memoList], 'secMemos');
            }

            load();
        }

        // ---- the router
        function render() {
            say('');
            var route = parseHash(location.hash);
            if (route.name === 'login') {
                turn += 1;
                viewLogin();
            } else if (!me) {
                turn += 1;
                go('#/login');
            } else if (route.name === 'password') {
                turn += 1;
                viewPassword();
            } else if (me.must_change_password) {
                go('#/password');
            } else if (route.name === 'detail') {
                viewDetail(route.id);
            } else {
                viewList(route.query);
            }
        }

        function handleHashChange() {
            // A notice that the previous screen left on purpose (a sign-in message) is kept once.
            var kept = notice.textContent;
            var kind = notice.className;
            render();
            var name = parseHash(location.hash).name;
            if (kept && (name === 'login' || name === 'password') && notice.hidden) {
                notice.textContent = kept;
                notice.className = kind;
                notice.hidden = false;
            }
        }

        logoutButton.addEventListener('click', function () {
            logoutButton.disabled = true;
            api.logout().then(function () {
                logoutButton.disabled = false;
                me = null;
                showWho();
                go('#/login');
                say('로그아웃했어요.', 'info');
            });
        });
        window.addEventListener('hashchange', handleHashChange);

        // ---- start: is there a session already (a reload)?
        api.me().then(function (answer) {
            if (answer.ok) {
                me = answer.data;
                showWho();
            }
            render();
        });

        // For the tests, which load the screen again and again into one window.
        var instance = { dispose: function () { window.removeEventListener('hashchange', handleHashChange); } };
        exported.instance = instance;
        return instance;
    }

    var exported = { init: init, parseHash: parseHash, buildHash: buildHash, instance: null };
    globalThis.AdminApp = exported;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
