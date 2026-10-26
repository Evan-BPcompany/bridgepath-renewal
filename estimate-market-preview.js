// The price range on the shoes and golf tee pages (step 2): once the material and the quantity are
// given, POST /api/estimate-preview is asked for a range and it is shown under the quantity, with the
// minimum order. The same service as the sunglasses use (estimate-preview.js), with its own rules on
// the server: shoes are counted in pairs (minimum 600), golf tees in packages of 50 (minimum 1,000).
//
// Nothing here blocks the request: when the range cannot be had, a short line says so and the
// visitor goes on. Nothing is stored and no personal data is sent: the kind of product, the material
// and the quantity only. Texts are put in with textContent; no value of the form or of the answer
// goes into markup.
(function () {
    'use strict';

    var TIMEOUT_MS = 15000;
    var DELAY_MS = 500;
    var MAX_QUANTITY = 1000000;

    var PAGES = Object.freeze({
        shoes: Object.freeze({ unit: '켤레', per: '켤레당', minimum: 600, minimumText: '최소 주문 수량은 600켤레예요.' }),
        golf: Object.freeze({ unit: '패키지', per: '1패키지(50개입)당', minimum: 1000, minimumText: '최소 주문 수량은 1,000패키지(1패키지 = 50개입)예요.' })
    });

    var MESSAGES = Object.freeze({
        loading: '예상 가격을 계산하고 있어요…',
        unavailable: '이 조건은 예상 가격을 바로 안내하기 어려워요. 정식 견적을 요청하시면 담당자가 확인해 드려요.',
        busy: '요청이 많아 잠시 후 다시 확인해 주세요. 정식 견적 요청은 그대로 진행할 수 있어요.',
        failed: '예상 가격을 불러오지 못했어요. 정식 견적 요청은 그대로 진행할 수 있어요.',
        notice: '입력하신 정보로 계산한 예상 범위이며 확정 견적이 아닙니다. 운송비·관세·금형·로고·포장 비용은 포함하지 않았어요. 정식 견적은 담당자가 확인한 뒤 안내드립니다.'
    });

    // "600" -> 600. Anything that is not a whole number from 1 to 1,000,000 is not a quantity yet.
    function parseQuantity(raw) {
        var text = String(raw === undefined || raw === null ? '' : raw).trim();
        if (!/^\d{1,7}$/.test(text)) {
            return null;
        }
        var number = Number(text);
        return number >= 1 && number <= MAX_QUANTITY ? number : null;
    }

    // The body of the price request, or null while the material or the quantity is not given.
    // `subtype` is the card of the shoes page (sneakers, heels, ...); the golf page has one product.
    function readInput(page, subtype, values) {
        var material = values && typeof values.material === 'string' ? values.material : '';
        var quantity = parseQuantity(values ? values.quantity : '');
        if (!PAGES[page] || !material || quantity === null) {
            return null;
        }
        return { category: page === 'golf' ? 'golf_tee' : subtype || 'shoes', material: material, quantity: quantity };
    }

    function formatWon(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    function formatRange(range) {
        return range.min === range.max ? '약 ' + formatWon(range.min) : '약 ' + formatWon(range.min) + ' ~ ' + formatWon(range.max);
    }

    // What the answer of the server means for the visitor: { kind, lines }.
    function interpret(page, status, body) {
        var settings = PAGES[page];
        if (status === 429) {
            return { kind: 'busy', lines: [MESSAGES.busy] };
        }
        if (status !== 200 || !body || typeof body !== 'object') {
            return { kind: 'failed', lines: [MESSAGES.failed] };
        }
        if (body.available === true && body.unit_price && body.total_price) {
            return {
                kind: 'range',
                lines: [
                    settings.per + ' ' + formatRange(body.unit_price),
                    '총 ' + formatRange(body.total_price),
                    MESSAGES.notice
                ]
            };
        }
        if (body.reason === 'BELOW_MINIMUM') {
            return { kind: 'minimum', lines: [settings.minimumText] };
        }
        return { kind: 'unavailable', lines: [MESSAGES.unavailable] };
    }

    async function requestPreview(apiBase, input, doFetch) {
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
        try {
            var response = await doFetch(String(apiBase || '').replace(/\/+$/, '') + '/api/estimate-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
                signal: controller ? controller.signal : undefined
            });
            var body = null;
            try {
                body = await response.json();
            } catch (_error) {
                body = null;
            }
            return { status: response.status, body: body };
        } catch (_error) {
            return { status: 0, body: null };
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    function init() {
        var body = document.body;
        var page = body ? body.getAttribute('data-estimate-page') : '';
        var box = document.getElementById('marketPreview');
        var materialSelect = document.getElementById('material');
        var quantityInput = document.getElementById('quantity');
        var config = globalThis.BridgePathConfig;
        if (!PAGES[page] || !box || !materialSelect || !quantityInput || !config || typeof globalThis.fetch !== 'function') {
            return;
        }

        var timer = null;
        var ticket = 0;

        function subtype() {
            var card = document.querySelector('.category-card.selected');
            return card ? card.getAttribute('data-category') : '';
        }

        function show(lines, kind) {
            box.textContent = '';
            box.hidden = lines.length === 0;
            box.setAttribute('data-kind', kind || '');
            lines.forEach(function (line, index) {
                var paragraph = document.createElement('p');
                paragraph.className = index === 0 && kind === 'range' ? 'market-preview-main' : 'market-preview-line';
                paragraph.textContent = line;
                box.appendChild(paragraph);
            });
        }

        async function refresh() {
            var mine = ticket += 1;
            var quantity = parseQuantity(quantityInput.value);
            // Under the minimum the visitor is told so at once, without asking the server.
            if (quantity !== null && quantity < PAGES[page].minimum) {
                show(interpret(page, 200, { available: false, reason: 'BELOW_MINIMUM' }).lines, 'minimum');
                return;
            }
            var input = readInput(page, subtype(), { material: materialSelect.value, quantity: quantityInput.value });
            if (!input) {
                show([], '');
                return;
            }
            show([MESSAGES.loading], 'loading');
            var answer = await requestPreview(config.API_BASE, input, function (url, init) { return globalThis.fetch(url, init); });
            if (mine !== ticket) {
                return; // a newer question was asked meanwhile
            }
            var result = interpret(page, answer.status, answer.body);
            show(result.lines, result.kind);
        }

        function later() {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(refresh, DELAY_MS);
        }

        materialSelect.addEventListener('change', later);
        quantityInput.addEventListener('input', later);
        show([], '');
    }

    var api = Object.freeze({
        PAGES: PAGES,
        MESSAGES: MESSAGES,
        parseQuantity: parseQuantity,
        readInput: readInput,
        formatRange: formatRange,
        interpret: interpret,
        requestPreview: requestPreview,
        init: init
    });

    globalThis.BridgePathMarketPreview = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
