// The "내 견적" page (my-quotes.html): the requests of the signed-in customer, and for each the
// detailed quote that the staff published. Signed-out visitors are sent to the login page and come
// back here. Everything from the server is put in with textContent; nothing here builds HTML and
// nothing is kept in the browser.
(function () {
    'use strict';

    var CATEGORY = Object.freeze({
        eyewear: '선글라스·안경', shoes: '신발', golf_products: '골프용품', other: '기타 맞춤 제품'
    });
    var KIND = Object.freeze({ simple: '간단 접수', detailed: '담당자 상세견적 요청' });

    var page = {
        // Replaced by the tests: the browser cannot be sent anywhere inside jsdom.
        go: function (url) {
            window.location.assign(url);
        }
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
        }
        show('detail');
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
        byId('whoName').textContent = customer.name || customer.email;
        byId('whoName').hidden = false;
        byId('logoutBtn').hidden = false;
        byId('logoutBtn').addEventListener('click', async function () {
            byId('logoutBtn').disabled = true;
            await auth.logout();
            page.go('index.html');
        });

        if (receipt) {
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
