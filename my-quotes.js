// The "내 견적" page (my-quotes.html): the requests of the signed-in customer, and for each the
// detailed quote that the staff published. Signed-out visitors are sent to the login page and come
// back here. Everything from the server is put in with textContent; nothing here builds HTML and
// nothing is kept in the browser.
(function () {
    'use strict';

    var CATEGORY = Object.freeze({
        eyewear: '선글라스·안경', shoes: '신발', golf_products: '골프티', other: '기타 맞춤 제품'
    });
    var KIND = Object.freeze({ simple: '간단 접수', detailed: '담당자 상세견적 요청' });

    var page = {
        // Replaced by the tests: the browser cannot be sent anywhere inside jsdom.
        go: function (url) {
            window.location.assign(url);
        },
        // The signed-in customer and the receipt number that is shown.
        state: { customer: null, receipt: null }
    };

    function Auth() {
        return globalThis.BridgePathAuth;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function won(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    // "2026-10-21" in Korean time, from the ISO time of the API.
    function dateOf(value) {
        var date = new Date(value);
        if (isNaN(date.getTime())) {
            return '';
        }
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
        } catch (error) {
            return '';
        }
    }

    function showError(text) {
        var box = byId('error');
        box.textContent = text;
        box.hidden = false;
    }

    function show(view) {
        byId('loading').hidden = true;
        byId('viewList').hidden = view !== 'list';
        byId('viewDetail').hidden = view !== 'detail';
    }

    // What the customer is told about a request. Never an internal status: only whether a quote is there.
    function stateText(item) {
        if (item.has_quote) {
            return '담당자 상세견적이 도착했어요';
        }
        if (item.request_kind === 'detailed') {
            return '담당자가 확인하고 있어요 · 업무일 기준 2~3일 정도 걸릴 수 있어요';
        }
        return '접수되었어요';
    }

    function drawList(items) {
        var list = byId('list');
        clear(list);
        byId('listEmpty').hidden = items.length > 0;
        items.forEach(function (item) {
            var link = el('a', 'mq-card');
            link.setAttribute('href', 'my-quotes.html?r=' + encodeURIComponent(item.receipt_id));
            var top = el('div', 'mq-card-top');
            top.appendChild(el('strong', '', item.receipt_id));
            top.appendChild(el('span', 'mq-badge' + (item.request_kind === 'detailed' ? ' mq-detailed' : ''), KIND[item.request_kind] || ''));
            link.appendChild(top);
            link.appendChild(el('p', 'mq-card-meta', (CATEGORY[item.category] || '') + ' · ' + dateOf(item.created_at) + ' 접수'));
            link.appendChild(el('p', 'mq-card-state' + (item.has_quote ? ' mq-ready' : ''), stateText(item)));
            var row = el('li');
            row.appendChild(link);
            list.appendChild(row);
        });
        show('list');
    }

    function fact(list, label, value) {
        if (value === null || value === undefined || value === '') {
            return;
        }
        list.appendChild(el('dt', '', label));
        list.appendChild(el('dd', '', value));
    }

    function drawDetail(data) {
        var estimate = data.estimate;
        byId('detailTitle').textContent = '접수 ' + estimate.receipt_id;
        byId('detailMeta').textContent =
            (CATEGORY[estimate.category] || '') + (estimate.quantity ? ' · ' + Number(estimate.quantity).toLocaleString('ko-KR') + '개' : '') +
            ' · ' + dateOf(estimate.created_at) + ' 접수 · ' + (KIND[estimate.request_kind] || '');

        var quote = data.quote;
        byId('waiting').hidden = Boolean(quote) || estimate.request_kind !== 'detailed';
        byId('quote').hidden = !quote;
        if (quote) {
            byId('quoteMeta').textContent = dateOf(quote.published_at) + ' 작성 · 버전 ' + quote.version;
            var body = byId('quoteItems');
            clear(body);
            quote.items.forEach(function (item) {
                var row = el('tr');
                row.appendChild(el('td', '', item.name));
                row.appendChild(el('td', 'num', Number(item.quantity).toLocaleString('ko-KR')));
                row.appendChild(el('td', 'num', won(item.unit_price)));
                row.appendChild(el('td', 'num', won(item.amount)));
                body.appendChild(row);
            });
            byId('quoteTotal').textContent = won(quote.total_amount);
            byId('expired').hidden = !quote.expired;

            var facts = byId('quoteFacts');
            clear(facts);
            fact(facts, '견적 유효기간', quote.valid_until ? quote.valid_until + '까지' + (quote.expired ? ' (지났어요)' : '') : '');
            fact(facts, '납기 예상', quote.lead_time);
            fact(facts, '적용 환율', quote.fx_currency && quote.fx_rate ? '1 ' + quote.fx_currency + ' = ' + Number(quote.fx_rate).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '원' : '');

            byId('noteBox').hidden = !quote.customer_note;
            byId('quoteNote').textContent = quote.customer_note || '';
            byId('helpReceipt').textContent = estimate.receipt_id;
            drawContact(quote.contact);
        }
        drawAsk(data);
        show('detail');
    }

    // ------------------------------------------------------------------------------------------
    // The staff member the customer can ask, and what the customer asked about the quote.

    var QUESTION_MAX = 300;

    var INQUIRY_ERRORS = Object.freeze({
        ALREADY_OPEN: '앞서 남기신 것이 아직 처리되지 않았어요. 처리된 뒤에 다시 남겨 주세요.',
        NO_QUOTE: '담당자 상세견적이 게시된 뒤에 남길 수 있어요.',
        TOO_MANY: '이 견적에는 더 이상 남길 수 없어요. 아래 담당자 연락처로 직접 연락해 주세요.',
        ESTIMATE_NOT_FOUND: '찾을 수 없는 견적이에요.'
    });

    function inquiryMessage(result) {
        if (result.code === 'VALIDATION_ERROR' && result.body && Array.isArray(result.body.details) && result.body.details[0]) {
            var field = result.body.details[0].field;
            if (field === 'body') {
                return '내용을 확인해 주세요. 300자 이내로 적어 주세요.';
            }
            if (field === 'phone') {
                return Auth().messageFor('phone_invalid');
            }
        }
        return Object.prototype.hasOwnProperty.call(INQUIRY_ERRORS, result.code) ? INQUIRY_ERRORS[result.code] : Auth().messageFor(result.code);
    }

    var PREFERRED = Object.freeze({ any: '아무 때나', weekday_am: '평일 오전', weekday_pm: '평일 오후' });

    // Only a plain e-mail address or phone number becomes a link; anything else stays text.
    function contactLink(kind, value) {
        var plain = kind === 'mail' ? /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/ : /^[0-9+\-()\s]{7,20}$/;
        if (!plain.test(value)) {
            return el('span', '', value);
        }
        var link = el('a', '', value);
        link.setAttribute('href', (kind === 'mail' ? 'mailto:' : 'tel:') + (kind === 'mail' ? value : value.replace(/[^0-9+]/g, '')));
        return link;
    }

    function drawContact(contact) {
        var facts = byId('contactFacts');
        clear(facts);
        var any = contact && (contact.name || contact.email || contact.phone);
        byId('contactBox').hidden = !any;
        if (!any) {
            return;
        }
        [['이름', contact.name, null], ['이메일', contact.email, 'mail'], ['전화', contact.phone, 'tel']].forEach(function (row) {
            if (!row[1]) {
                return;
            }
            facts.appendChild(el('dt', '', row[0]));
            var value = el('dd');
            value.appendChild(row[2] ? contactLink(row[2], row[1]) : document.createTextNode(row[1]));
            facts.appendChild(value);
        });
    }

    function showFormError(id, text) {
        var box = byId(id);
        box.textContent = text;
        box.hidden = false;
    }

    function drawAsk(data) {
        var box = byId('askBox');
        box.hidden = !data.quote;
        if (!data.quote) {
            return;
        }
        var inquiries = Array.isArray(data.inquiries) ? data.inquiries : [];
        var questions = inquiries.filter(function (item) { return item.kind === 'question'; });
        var consults = inquiries.filter(function (item) { return item.kind === 'consultation'; });

        // The questions and the answers, newest first.
        var thread = byId('thread');
        clear(thread);
        questions.slice().reverse().forEach(function (item) {
            var row = el('li', 'mq-thread-item');
            row.appendChild(el('p', 'mq-meta', '내 질문 · ' + dateOf(item.created_at)));
            row.appendChild(el('p', 'mq-text', item.body));
            if (item.status === 'answered' && item.answer) {
                row.appendChild(el('p', 'mq-meta', '담당자 답변 · ' + dateOf(item.handled_at)));
                row.appendChild(el('p', 'mq-text mq-answer', item.answer));
            } else {
                row.appendChild(el('p', 'mq-meta mq-pending', '답변을 기다리고 있어요'));
            }
            thread.appendChild(row);
        });
        var waiting = questions.some(function (item) { return item.status === 'open'; });
        byId('questionForm').hidden = waiting;
        byId('questionWaiting').hidden = !waiting;

        // The consultation: asked and waiting for the call, or done, or not asked yet.
        var state = byId('consultState');
        clear(state);
        var open = consults.filter(function (item) { return item.status === 'open'; })[0];
        var done = consults.filter(function (item) { return item.status === 'done'; }).pop();
        state.hidden = !open && !done;
        byId('consultOpen').hidden = Boolean(open);
        byId('consultForm').hidden = true;
        if (open) {
            state.appendChild(el('strong', '', '심층상담을 요청했어요'));
            state.appendChild(el('p', '', '담당자가 확인한 뒤 ' + open.phone + '(으)로 전화드려요. · 편한 시간: ' + (PREFERRED[open.preferred_time] || '아무 때나')));
            if (open.body) {
                state.appendChild(el('p', 'mq-meta', '남기신 메모: ' + open.body));
            }
        } else if (done) {
            state.appendChild(el('strong', '', '지난 심층상담이 끝났어요 · ' + dateOf(done.handled_at)));
            if (done.answer) {
                state.appendChild(el('p', 'mq-meta', '담당자 메모: ' + done.answer));
            }
        }
    }

    // The same page again from the server, after something was sent.
    async function reload() {
        var one = await Auth().myEstimate(page.state.receipt);
        if (one.ok) {
            drawDetail(one.body);
        } else {
            showError(Auth().messageFor(one.code));
        }
    }

    function wireAsk() {
        var auth = Auth();
        var busy = false;

        byId('questionText').addEventListener('input', function () {
            byId('questionCounter').textContent = Array.from(byId('questionText').value).length + ' / ' + QUESTION_MAX;
        });

        byId('questionForm').addEventListener('submit', async function (event) {
            event.preventDefault();
            byId('questionError').hidden = true;
            var text = byId('questionText').value.trim();
            if (text === '') {
                showFormError('questionError', '질문을 적어 주세요.');
                return;
            }
            if (Array.from(text).length > QUESTION_MAX) {
                showFormError('questionError', '300자 이내로 적어 주세요.');
                return;
            }
            if (busy) {
                return;
            }
            busy = true;
            byId('questionSubmit').disabled = true;
            try {
                var result = await auth.sendInquiry(page.state.receipt, { kind: 'question', body: text });
                if (result.ok) {
                    byId('questionText').value = '';
                    byId('questionCounter').textContent = '0 / ' + QUESTION_MAX;
                    await reload();
                } else {
                    showFormError('questionError', inquiryMessage(result));
                }
            } finally {
                busy = false;
                byId('questionSubmit').disabled = false;
            }
        });

        byId('consultOpen').addEventListener('click', function () {
            var customer = page.state.customer || {};
            if (byId('consultPhone').value === '' && customer.phone) {
                byId('consultPhone').value = customer.phone;
            }
            byId('consultOpen').hidden = true;
            byId('consultForm').hidden = false;
            byId('consultPhone').focus();
        });

        byId('consultCancel').addEventListener('click', function () {
            byId('consultForm').hidden = true;
            byId('consultOpen').hidden = false;
            byId('consultError').hidden = true;
        });

        byId('consultForm').addEventListener('submit', async function (event) {
            event.preventDefault();
            byId('consultError').hidden = true;
            var phone = byId('consultPhone').value;
            var problem = auth.checkPhone(phone, true);
            if (problem) {
                showFormError('consultError', auth.messageFor(problem));
                return;
            }
            var note = byId('consultNote').value.trim();
            if (Array.from(note).length > QUESTION_MAX) {
                showFormError('consultError', '메모는 300자 이내로 적어 주세요.');
                return;
            }
            if (busy) {
                return;
            }
            busy = true;
            byId('consultSubmit').disabled = true;
            try {
                var payload = { kind: 'consultation', phone: phone.trim(), preferred_time: byId('consultTime').value };
                if (note !== '') {
                    payload.body = note;
                }
                var result = await auth.sendInquiry(page.state.receipt, payload);
                if (result.ok) {
                    byId('consultNote').value = '';
                    await reload();
                } else {
                    showFormError('consultError', inquiryMessage(result));
                }
            } finally {
                busy = false;
                byId('consultSubmit').disabled = false;
            }
        });
    }

    // The KakaoTalk notices can be agreed to and taken back here, at any time.
    function wireKakaoNotify(customer) {
        var box = byId('kakaoNotify');
        var message = byId('kakaoNotifyMsg');
        box.checked = Boolean(customer.kakao_notify);
        byId('notifyBox').hidden = false;
        box.addEventListener('change', async function () {
            var wanted = box.checked;
            box.disabled = true;
            message.textContent = '';
            var result = await Auth().setKakaoNotify(wanted);
            box.disabled = false;
            if (result.ok) {
                message.textContent = wanted ? '카카오톡 알림을 받을게요.' : '카카오톡 알림을 끌게요.';
            } else {
                box.checked = !wanted;
                message.textContent = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
            }
        });
    }

    async function init() {
        var auth = Auth();
        var params = new URLSearchParams(window.location.search);
        var receipt = params.get('r');
        var here = '/my-quotes.html' + (receipt ? '?r=' + encodeURIComponent(receipt) : '');

        var me = await auth.me();
        if (!me.ok || !me.body.customer) {
            // Not signed in (or the session ended): sign in, then come back to this very page.
            page.go('login.html?next=' + encodeURIComponent(auth.safeNext(here)));
            return;
        }
        var customer = me.body.customer;
        if (customer.consent_required || customer.phone_required) {
            page.go('login.html?step=complete&next=' + encodeURIComponent(auth.safeNext(here)));
            return;
        }
        page.state.customer = customer;
        page.state.receipt = receipt;
        byId('whoName').textContent = customer.name || customer.email;
        byId('whoName').hidden = false;
        byId('logoutBtn').hidden = false;
        byId('logoutBtn').addEventListener('click', async function () {
            byId('logoutBtn').disabled = true;
            await auth.logout();
            page.go('index.html');
        });

        wireKakaoNotify(customer);

        if (receipt) {
            wireAsk();
            var one = await auth.myEstimate(receipt);
            if (one.ok) {
                drawDetail(one.body);
            } else if (one.status === 404) {
                show('detail');
                byId('viewDetail').hidden = true;
                showError('찾을 수 없는 견적이에요. 접수번호를 확인해 주세요. ');
                var link = el('a', '', '← 내 견적 목록');
                link.setAttribute('href', 'my-quotes.html');
                byId('error').appendChild(link);
            } else if (one.status === 401) {
                page.go('login.html?next=' + encodeURIComponent(auth.safeNext(here)));
            } else {
                show('detail');
                byId('viewDetail').hidden = true;
                showError(auth.messageFor(one.code));
            }
            return;
        }

        var all = await auth.myEstimates();
        if (all.ok && Array.isArray(all.body.estimates)) {
            drawList(all.body.estimates);
        } else if (all.status === 401) {
            page.go('login.html?next=' + encodeURIComponent(auth.safeNext(here)));
        } else {
            show('list');
            showError(auth.messageFor(all.code));
        }
    }

    globalThis.BridgePathMyQuotes = page;
    page.init = init;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
