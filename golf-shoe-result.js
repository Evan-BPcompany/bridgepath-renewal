// The result screen of the golf shoe quote (and, since 2026-11-18, of the golf tee quote: PAGES below), shown when the visitor presses "AI 견적 시작" in step 2 (the photo was analysed by
// golf-shoe-photo.js). It shows what the photo analysis found (the recognised values can be corrected with "수정하기", which asks the
// price ranges again at once), the overseas (China) and the domestic price range for one pair and for the minimum order, and the
// analysis texts. The customer is never told where the prices come from, or how many listings they rest on.
//
// The specification is NOT asked before this screen. "담당자 상세견적 받으러 가기" asks the customer to log in (in a new tab; the photo
// and the result stay on this one); after that, step 2 comes back as the specification form, filled with the recognised outsole and
// material, and the request goes on to step 3 as a detailed one (answered in two to three working days).
//
// Nothing here stores anything. Every text is put in with textContent and every list item is a new element; no value of the form or of
// an answer goes into markup.
(function () {
    'use strict';

    // What differs between the golf shoe and the golf tee: the range asked, the recognised values that can be corrected (key of the
    // analysis and of the range request, select, text), the unit of the order, the fields of the specification they fill, the texts.
    var PAGES = Object.freeze({
        shoes: Object.freeze({
            path: '/api/estimate-preview/golf-shoe-range',
            fields: [['closure', 'resultClosure', 'resultClosureText'], ['outsole', 'resultOutsole', 'resultOutsoleText'], ['upper_material', 'resultUpper', 'resultUpperText']],
            fill: [['material', 'upper_material'], ['outsole', 'outsole']],
            unit: '켤레',
            photoTitle: '골프화 사진을 올려 주세요',
            photoDescription: '사진 1장이면 AI가 골프화를 분석해 해외·국내 예상 가격 범위를 보여 드립니다.'
        }),
        golf: Object.freeze({
            path: '/api/estimate-preview/golf-tee-range',
            fields: [['material', 'resultMaterial', 'resultMaterialText']],
            fill: [['material', 'material']],
            unit: '패키지',
            photoTitle: '골프티 사진을 올려 주세요',
            photoDescription: '사진 1장이면 AI가 골프티를 분석해 해외·국내 예상 가격 범위를 보여 드립니다.'
        })
    });
    var RANGE_TIMEOUT_MS = 15000;
    var RANGE_DELAY_MS = 300;

    var TEXTS = Object.freeze({
        calculating: '예상 비용을 계산하고 있습니다…',
        busy: '요청이 많아 잠시 후 다시 확인하세요. 담당자 상세견적은 그대로 요청할 수 있습니다.',
        failed: '예상 비용을 불러오지 못했습니다. 담당자 상세견적으로 확인할 수 있습니다.',
        notice: '참고용 범위이며 확정 견적이 아닙니다. 운송비·관세·금형·로고·포장 비용은 포함하지 않았습니다. 정식 견적은 담당자가 확인한 뒤 안내드립니다.',
        recognised: 'AI가 업로드한 사진을 분석한 결과입니다. 실제와 다르면 ‘수정하기’에서 고치면 가격 범위가 바로 다시 계산됩니다.',
        edited: 'AI 분석과 다르게 직접 고르신 값으로 계산했습니다.',
        unavailable: '이 사양은 상세견적이 필요합니다. 담당자가 확인해 드립니다.',
        specTitle: '상세견적에 필요한 사양을 입력하세요',
        specDescription: '입력하신 사양을 담당자가 확인한 뒤 업무일 기준 2~3일 안에 상세견적을 안내드립니다. AI가 읽은 값은 미리 채워 두었으니 확인하세요.',
        photoTitle: PAGES.shoes.photoTitle,
        photoDescription: PAGES.shoes.photoDescription
    });

    var COMPLEXITY = Object.freeze({ low: '낮음', medium: '중간', high: '높음' });
    var STYLE = Object.freeze({ sneaker: '스니커형', classic: '클래식형', boot: '부츠형', sandal: '샌들형', other: '기타' });
    var SHAPE = Object.freeze({ standard: '기본형', castle: '높이 고정형(캐슬)', brush: '브러시형', prong: '갈래형', other: '기타' });

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, text) {
        var element = byId(id);
        if (element) {
            element.textContent = text;
        }
    }

    function setHidden(id, hidden) {
        var element = byId(id);
        if (element) {
            element.hidden = hidden;
        }
    }

    function nonEmpty(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function labelOf(select, value) {
        for (var i = 0; i < select.options.length; i += 1) {
            if (select.options[i].value === value) {
                return select.options[i].textContent;
            }
        }
        return value;
    }

    // Replaces the items of a list and hides its box when there is nothing to show.
    function fillList(listId, boxId, items) {
        var list = byId(listId);
        var texts = Array.isArray(items) ? items.filter(nonEmpty) : [];
        if (!list) {
            return;
        }
        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }
        texts.forEach(function (text) {
            var item = document.createElement('li');
            item.textContent = text;
            list.appendChild(item);
        });
        setHidden(boxId, texts.length === 0);
    }

    // ------------------------------------------------------------------------------------------
    // Pure helpers

    function formatWon(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    function formatRange(range) {
        return formatWon(range.low) + ' ~ ' + formatWon(range.high);
    }

    function formatUsd(amount) {
        return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    }

    function joinUrl(apiBase, path) {
        return String(apiBase || '').replace(/\/+$/, '') + path;
    }

    // The values of the range request, "unknown" for a select that has no value (the three of the golf shoe unless keys are given).
    function readSpec(values, keys) {
        function pick(value) {
            return typeof value === 'string' && value ? value : 'unknown';
        }
        var spec = {};
        (keys || ['outsole', 'closure', 'upper_material']).forEach(function (key) {
            spec[key] = pick(values && values[key]);
        });
        return spec;
    }

    function isRange(value) {
        return !!value && typeof value.low === 'number' && typeof value.high === 'number';
    }

    // What to do with the answer of the range: { kind: 'range', overseas, domestic, moq, notice } or { kind: 'busy' | 'failed' }.
    function interpretRange(status, body) {
        if (status === 429) {
            return { kind: 'busy' };
        }
        if (status !== 200 || !body || typeof body !== 'object' || !body.overseas || !body.domestic) {
            return { kind: 'failed' };
        }
        return {
            kind: 'range',
            overseas: body.overseas,
            domestic: body.domestic,
            moq: typeof body.moq === 'number' ? body.moq : null,
            notice: typeof body.notice === 'string' && body.notice ? body.notice : TEXTS.notice
        };
    }

    // What the table shows for one region: { ok, unit, sub, moq, total } for a range, { ok: false, message } without one. The
    // message is the one of the server when it has one (it never tells how many listings there were).
    function describeRegion(region, moq, unit) {
        if (!region || region.status !== 'ok' || !isRange(region.unit_krw)) {
            return { ok: false, message: region && nonEmpty(region.reason) ? region.reason : TEXTS.unavailable };
        }
        var total = region.total_krw;
        return {
            ok: true,
            unit: formatRange(region.unit_krw),
            sub: region.currency === 'USD' && typeof region.low === 'number' && typeof region.high === 'number'
                ? '약 ' + formatUsd(region.low) + ' ~ ' + formatUsd(region.high)
                : '',
            moq: moq ? moq.toLocaleString('ko-KR') + (unit || '켤레') : '—',
            total: isRange(total) ? formatRange(total) : '—'
        };
    }

    // ------------------------------------------------------------------------------------------
    // The page

    var photoUrl = null;

    function showPhoto(file) {
        var image = byId('resultPhoto');
        if (photoUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(photoUrl);
        }
        photoUrl = null;
        if (file && image && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            photoUrl = URL.createObjectURL(file);
            image.src = photoUrl;
            setHidden('resultPhotoBox', false);
        } else {
            setHidden('resultPhotoBox', true);
        }
    }

    function init() {
        var body = document.body;
        var photoApi = globalThis.BridgePathGolfShoePhoto;
        var flow = globalThis.BridgePathFlow;
        var config = globalThis.BridgePathConfig;
        var screen = byId('result-content');
        var stepTwo = byId('step2-content');
        var product = body ? PAGES[body.getAttribute('data-estimate-page')] : null;
        if (!product || !screen || !stepTwo || !photoApi || !flow || !config || typeof globalThis.fetch !== 'function') {
            return;
        }

        var editButton = byId('resultEditBtn');
        var nextButton = byId('nextBtn2');
        var sequence = 0;
        var rangeTimer = null;
        var editing = false;
        var recognised = {};
        // the minimum order of the last range that was shown (300 pairs, 800 with spikes or a dial; 1,000 packages of tees)
        var lastMoq = null;

        // [key, select, text id] of each recognised value
        var PAIRS = product.fields.map(function (field) {
            return [field[0], byId(field[1]), field[2]];
        });
        var KEYS = PAIRS.map(function (pair) { return pair[0]; });

        function activate() {
            var current = document.querySelector('.step-content.active');
            if (current) {
                current.classList.remove('active');
            }
            screen.classList.add('active');
            if (typeof window.scrollTo === 'function') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
            var heading = screen.querySelector('h2');
            if (heading) {
                heading.setAttribute('tabindex', '-1');
                heading.focus();
            }
        }

        function spec() {
            var values = {};
            PAIRS.forEach(function (pair) {
                values[pair[0]] = pair[1].value;
            });
            return readSpec(values, KEYS);
        }

        function updateTexts() {
            PAIRS.forEach(function (pair) {
                pair[1].hidden = !editing;
                setText(pair[2], labelOf(pair[1], pair[1].value));
                var text = byId(pair[2]);
                if (text) {
                    text.hidden = editing;
                }
            });
            var wanted = spec();
            var changed = KEYS.some(function (key) { return wanted[key] !== recognised[key]; });
            setText('resultRecognitionNote', changed ? TEXTS.edited : TEXTS.recognised);
            if (editButton) {
                editButton.textContent = editing ? '수정 완료' : '수정하기';
                editButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
            }
        }

        // ---- the table of the two regions
        var CELLS = {
            overseas: { unit: 'resultOverseasUnit', moq: 'resultOverseasMoq', total: 'resultOverseasTotal' },
            domestic: { unit: 'resultDomesticUnit', moq: 'resultDomesticMoq', total: 'resultDomesticTotal' }
        };

        function fillRegion(key, region, moq) {
            var cells = CELLS[key];
            var unitCell = byId(cells.unit);
            var moqCell = byId(cells.moq);
            var totalCell = byId(cells.total);
            var info = describeRegion(region, moq, product.unit);
            unitCell.textContent = '';
            unitCell.classList.toggle('result-unavailable', !info.ok);
            if (!info.ok) {
                // one cell for the three rows: the message only
                unitCell.rowSpan = 3;
                unitCell.textContent = info.message;
                moqCell.hidden = true;
                totalCell.hidden = true;
                return;
            }
            unitCell.rowSpan = 1;
            unitCell.appendChild(document.createTextNode(info.unit));
            if (info.sub) {
                var small = document.createElement('small');
                small.textContent = info.sub;
                unitCell.appendChild(small);
            }
            moqCell.hidden = false;
            moqCell.textContent = info.moq;
            totalCell.hidden = false;
            totalCell.textContent = info.total;
        }

        function showCost(result) {
            var table = byId('resultCostTable');
            if (result.kind !== 'range') {
                table.hidden = true;
                setText('resultCostStatus', result.kind === 'busy' ? TEXTS.busy : TEXTS.failed);
                setText('resultNotice', '');
                return;
            }
            setText('resultCostStatus', '');
            lastMoq = result.moq;
            fillRegion('overseas', result.overseas, result.moq);
            fillRegion('domestic', result.domestic, result.moq);
            table.hidden = false;
            setText('resultNotice', result.notice);
        }

        async function refreshRange() {
            sequence += 1;
            var mine = sequence;
            var table = byId('resultCostTable');
            table.hidden = true;
            setText('resultNotice', '');
            setText('resultCostStatus', TEXTS.calculating);
            var result;
            var request = new AbortController();
            var timer = setTimeout(function () { request.abort(); }, RANGE_TIMEOUT_MS);
            try {
                var response = await globalThis.fetch(joinUrl(config.API_BASE, product.path), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(spec()),
                    signal: request.signal
                });
                var answer;
                try {
                    answer = await response.json();
                } catch (parseError) {
                    answer = undefined;
                }
                result = interpretRange(response.status, answer);
            } catch (error) {
                result = { kind: 'failed' };
            } finally {
                clearTimeout(timer);
            }
            // An answer for a value that was changed again meanwhile is dropped.
            if (mine === sequence) {
                showCost(result);
            }
        }

        function later() {
            if (rangeTimer) {
                clearTimeout(rangeTimer);
            }
            rangeTimer = setTimeout(refreshRange, RANGE_DELAY_MS);
        }

        // ---- the texts of the analysis
        function showAnalysis(analysis) {
            var overview = nonEmpty(analysis.overview) ? analysis.overview : '';
            setText('resultOverview', overview);
            setHidden('resultOverviewBox', overview === '');
            var level = COMPLEXITY[analysis.complexity];
            setText('resultComplexity', level ? '복잡도 · ' + level : '');
            setHidden('resultComplexity', !level);

            // the facts a page shows next to the values (the style of a shoe; the shape, length and colour of a tee)
            [['resultStyle', 'resultStyleRow', STYLE[analysis.style]], ['resultShape', 'resultShapeRow', SHAPE[analysis.shape]],
                ['resultLength', 'resultLengthRow', nonEmpty(analysis.length) ? analysis.length : ''],
                ['resultColor', 'resultColorRow', nonEmpty(analysis.color) ? analysis.color : '']].forEach(function (fact) {
                setText(fact[0], fact[2] || '');
                setHidden(fact[1], !fact[2]);
            });

            // each text of the details goes to resultDetail + its key (Upper, Sole, ... for a shoe; Body, Head, Finish for a tee)
            var details = analysis.details && typeof analysis.details === 'object' ? analysis.details : null;
            Object.keys(details || {}).forEach(function (key) {
                setText('resultDetail' + key.charAt(0).toUpperCase() + key.slice(1), nonEmpty(details[key]) ? details[key] : '');
            });
            setHidden('resultDetailsBox', !details);

            fillList('resultUnconfirmed', 'resultUnconfirmedBox', analysis.unconfirmed);
            fillList('resultFactors', 'resultFactorsBox', analysis.cost_factors);
            fillList('resultRecommendations', 'resultRecommendBox', analysis.recommendations);
        }

        function show() {
            var photo = photoApi.getPhoto();
            if (!photo.analysis) {
                return;
            }
            var analysis = photo.analysis;
            recognised = {};
            PAIRS.forEach(function (pair) {
                pair[1].value = analysis[pair[0]];
                if (pair[1].value !== analysis[pair[0]]) {
                    pair[1].value = 'unknown';
                }
                recognised[pair[0]] = pair[1].value;
            });
            editing = false;
            showPhoto(photo.file);
            showAnalysis(analysis);
            updateTexts();
            activate();
            refreshRange();
        }

        PAIRS.forEach(function (pair) {
            pair[1].addEventListener('change', function () {
                updateTexts();
                later();
            });
        });
        if (editButton) {
            editButton.addEventListener('click', function () {
                editing = !editing;
                updateTexts();
            });
        }

        // ---- step 2 has two faces: the photo (before the result) and the specification (for the detailed quote)
        function setStage(stage) {
            body.setAttribute('data-golf-stage', stage);
            var isSpec = stage === 'spec';
            setHidden('photoStage', isSpec);
            setHidden('specForm', !isSpec);
            setText('step2Title', isSpec ? TEXTS.specTitle : product.photoTitle);
            setText('step2Description', isSpec ? TEXTS.specDescription : product.photoDescription);
            nextButton.textContent = isSpec ? '다음 단계' : 'AI 견적 시작';
            nextButton.disabled = isSpec ? false : !photoApi.getPhoto().analysis;
        }

        // The recognised values (outsole and material; the material of a tee) go into the specification, never over a value the
        // customer chose.
        function fillSpecification() {
            var wanted = spec();
            product.fill.forEach(function (pair) {
                var target = byId(pair[0]);
                var value = wanted[pair[1]];
                if (!target || value === 'unknown' || (target.value && !target.hasAttribute('data-ai-filled'))) {
                    return;
                }
                target.value = value;
                if (target.value === value) {
                    target.setAttribute('data-ai-filled', 'true');
                    target.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        function enterSpecification(customer) {
            flow.setDetailed(customer);
            setStage('spec');
            fillSpecification();
            if (lastMoq) {
                setText('quantityHint', 'AI 견적 기준 이 사양의 최소 주문 수량은 ' + lastMoq.toLocaleString('ko-KR') + product.unit + '입니다.');
            }
            if (typeof globalThis.goToStep === 'function') {
                globalThis.goToStep(2);
            }
            var heading = byId('step2Title');
            if (heading) {
                heading.setAttribute('tabindex', '-1');
                heading.focus();
            }
        }

        // Before the result the button starts it; in the specification the back button returns to the result, not to step 1.
        stepTwo.addEventListener('click', function (event) {
            var target = event.target && event.target.closest ? event.target : null;
            if (!target) {
                return;
            }
            var stage = body.getAttribute('data-golf-stage') === 'spec' ? 'spec' : 'photo';
            if (stage === 'photo' && target.closest('#nextBtn2')) {
                event.preventDefault();
                event.stopPropagation();
                show();
            } else if (stage === 'spec' && target.closest('#step2Back')) {
                event.preventDefault();
                event.stopPropagation();
                activate();
            }
        }, true);

        // ---- the detailed quote from the staff (for signed-in customers only)
        var detailedButton = byId('detailedBtn');
        var loginBox = byId('detailedLogin');
        var waitingForLogin = false;
        var checking = false;

        function goOnAsCustomer(customer) {
            waitingForLogin = false;
            if (loginBox) {
                loginBox.hidden = true;
            }
            enterSpecification(customer);
        }

        async function checkSignedIn() {
            var auth = globalThis.BridgePathAuth;
            if (!auth || checking) {
                return false;
            }
            checking = true;
            try {
                var me = await auth.me();
                if (me.ok && me.body && me.body.customer) {
                    goOnAsCustomer(me.body.customer);
                    return true;
                }
                return false;
            } finally {
                checking = false;
            }
        }

        if (detailedButton) {
            detailedButton.addEventListener('click', async function () {
                if (!(await checkSignedIn()) && loginBox) {
                    waitingForLogin = true;
                    loginBox.hidden = false;
                }
            });
            var comeBack = function () {
                if (waitingForLogin && screen.classList.contains('active')) {
                    checkSignedIn();
                }
            };
            window.addEventListener('focus', comeBack);
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) {
                    comeBack();
                }
            });
        }

        // "다른 사진으로 다시 하기": back to the photo, as a simple visitor again.
        var backButton = byId('resultBackBtn');
        if (backButton) {
            backButton.addEventListener('click', function () {
                waitingForLogin = false;
                sequence += 1;
                flow.setSimple();
                setStage('photo');
                if (typeof globalThis.goToStep === 'function') {
                    globalThis.goToStep(2);
                }
            });
        }

        api.show = show;
    }

    var api = { init: init, show: null, readSpec: readSpec, interpretRange: interpretRange, describeRegion: describeRegion, TEXTS: TEXTS, PAGES: PAGES };
    globalThis.BridgePathGolfShoeResult = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
