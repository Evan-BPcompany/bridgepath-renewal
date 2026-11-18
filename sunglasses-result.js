// The result screen of the sunglasses quote (2026-11-18, the same flow as the golf shoe, golf-shoe-result.js), shown when the visitor
// presses "AI 견적 시작" in step 2 (the photo was analysed by golf-shoe-photo.js). It shows what the photo analysis found (frame, lens and
// lens options, corrected with "수정하기", which asks the cost again at once) and the cost SIMULATION of POST
// /api/estimate-preview/sunglasses-cost: the frame, the lens and the other costs, the unit cost, the quantity and the total, with the
// notice that it is a virtual quote. The public supplier prices are shown apart from it, as a reference of another kind, never with
// their sources. A part the photo cannot show is not decided for the visitor: the cost spans its values until they choose one.
//
// The specification is NOT asked before this screen. "담당자 상세견적 받으러 가기" asks the customer to log in (in a new tab); after that,
// step 2 comes back as the specification form, filled with what was recognised, and the request goes on to step 3 as a detailed one.
//
// shortcut: the detailed-quote part (log in, specification stage, back button) is a copy of golf-shoe-result.js; move it into one shared
// script when a third page (the golf tee) needs it.
//
// Nothing here stores anything. Every text is put in with textContent and every list item is a new element.
(function () {
    'use strict';

    var PAGE = 'sunglasses';
    var COST_TIMEOUT_MS = 15000;
    var COST_DELAY_MS = 300;
    var DEFAULT_QUANTITY = 1000;
    var MAX_QUANTITY = 1000000;

    var TEXTS = Object.freeze({
        calculating: '예상 제조원가를 계산하고 있습니다…',
        busy: '요청이 많아 잠시 후 다시 확인하세요. 담당자 상세견적은 그대로 요청할 수 있습니다.',
        failed: '예상 제조원가를 불러오지 못했습니다. 담당자 상세견적으로 확인할 수 있습니다.',
        quantity: '생산 수량은 1개부터 1,000,000개까지의 정수로 입력하세요.',
        notice: '가상견적입니다. 프레임·렌즈·기타 비용을 나눠 계산한 예상 제조원가이며, 실제 공장 견적이나 공급업체 판매가격이 아닙니다.',
        recognised: 'AI가 업로드한 사진을 분석한 결과입니다. 실제와 다르면 ‘수정하기’에서 고치면 예상 제조원가가 바로 다시 계산됩니다.',
        edited: 'AI 분석과 다르게 직접 고르신 값으로 계산했습니다.',
        noOptions: '없음',
        reference: '참고: 같은 프레임 소재 선글라스의 공개 공급가격은 개당 약 ',
        specTitle: '상세견적에 필요한 사양을 입력하세요',
        specDescription: '입력하신 사양을 담당자가 확인한 뒤 업무일 기준 2~3일 안에 상세견적을 안내드립니다. AI가 읽은 값은 미리 채워 두었으니 확인하세요.',
        photoTitle: '선글라스 사진을 올려 주세요',
        photoDescription: '사진 1장이면 AI가 선글라스를 분석해 예상 제조원가를 보여 드립니다.'
    });

    var COMPLEXITY = Object.freeze({ low: '낮음', medium: '중간', high: '높음' });
    var OPTIONS = Object.freeze([['mirror', 'resultMirror', '미러 코팅'], ['gradient', 'resultGradient', '그라데이션'], ['photochromic', 'resultPhotochromic', '변색']]);
    // The analysis and the form of the request speak older words: what the recognised frame and lens are on the specification form.
    var SPEC_FRAME = Object.freeze({ pc: 'plastic', tr90: 'plastic', plastic: 'plastic', metal: 'metal', acetate: 'acetate', wood: 'wood', mixed: 'mixed' });

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
        if (boxId) {
            setHidden(boxId, texts.length === 0);
        }
    }

    // ------------------------------------------------------------------------------------------
    // Pure helpers

    function joinUrl(apiBase, path) {
        return String(apiBase || '').replace(/\/+$/, '') + path;
    }

    function formatUsd(amount) {
        return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatWon(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    // "$2.71", or "$2.35 ~ $2.77" when a part is not confirmed.
    function formatSpan(span, format) {
        var show = format || formatUsd;
        return span.low === span.high ? show(span.low) : show(span.low) + ' ~ ' + show(span.high);
    }

    function isSpan(value) {
        return !!value && typeof value.low === 'number' && typeof value.high === 'number';
    }

    // A whole number of pieces from 1 to MAX_QUANTITY, or null.
    function parseQuantity(text) {
        var value = Number(String(text || '').trim());
        return Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY ? value : null;
    }

    // The body of the cost request from the values on the screen; "unknown" for a select without a value.
    function readSpec(values) {
        function pick(value) {
            return typeof value === 'string' && value ? value : 'unknown';
        }
        return {
            frame: pick(values && values.frame),
            lens: pick(values && values.lens),
            mirror: !!(values && values.mirror),
            gradient: !!(values && values.gradient),
            photochromic: !!(values && values.photochromic),
            quantity: values && typeof values.quantity === 'number' ? values.quantity : DEFAULT_QUANTITY
        };
    }

    // What to do with the answer: { kind: 'cost', simulation, reference, assumptions, notice } or { kind: 'busy' | 'failed' }.
    function interpretCost(status, body) {
        if (status === 429) {
            return { kind: 'busy' };
        }
        var simulation = body && typeof body === 'object' ? body.simulation : null;
        if (status !== 200 || !simulation || !isSpan(simulation.unit_cost) || !isSpan(simulation.total_cost) || !isSpan(simulation.frame_cost) || !isSpan(simulation.lens_cost)) {
            return { kind: 'failed' };
        }
        return {
            kind: 'cost',
            simulation: simulation,
            reference: body.supplier_reference && body.supplier_reference.status === 'ok' && typeof body.supplier_reference.low === 'number' ? body.supplier_reference : null,
            assumptions: Array.isArray(body.assumptions) ? body.assumptions.filter(nonEmpty) : [],
            notice: nonEmpty(body.notice) ? body.notice : TEXTS.notice
        };
    }

    // The specification values of the request form that the recognised frame and lens stand for (null: leave the field).
    function specValues(frame, lens, options) {
        var lensType = null;
        if (options.photochromic) {
            lensType = 'photochromic';
        } else if (options.mirror) {
            lensType = 'mirror';
        } else if (options.gradient) {
            lensType = 'gradient';
        } else if (/_polarized$/.test(lens)) {
            lensType = 'polarized';
        } else if (/_standard$/.test(lens)) {
            lensType = 'normal';
        }
        return { frameMaterial: SPEC_FRAME[frame] || null, lensType: lensType };
    }

    // The record of what the screen showed, sent with the request (specification.ai_preview, src/utils/specification.ts): the analysis in
    // the words the API knows and the cost in won. It is advisory, never a quote; texts are cut to the limits of the API.
    function cut(value, max) {
        return typeof value === 'string' ? value.slice(0, max) : undefined;
    }

    function buildAiPreview(analysis, simulation) {
        var record = { source: 'customer_screen' };
        if (analysis) {
            var details = analysis.details && typeof analysis.details === 'object' ? analysis.details : {};
            record.analysis = {
                frame_material: analysis.frame_material,
                lens_type: analysis.lens_type,
                confidence: analysis.confidence,
                complexity: analysis.complexity,
                frame_shape: cut(analysis.frame_shape, 100),
                frame_color: cut(analysis.frame_color, 100),
                overview: cut(analysis.overview, 1000),
                details: { frame: cut(details.frame, 300), lens: cut(details.lens, 300), decoration: cut(details.decoration, 300) },
                cost_factors: (Array.isArray(analysis.cost_factors) ? analysis.cost_factors : []).slice(0, 4).map(function (item) { return cut(item, 200); }),
                recommendations: (Array.isArray(analysis.recommendations) ? analysis.recommendations : []).slice(0, 4).map(function (item) { return cut(item, 200); })
            };
        }
        if (simulation && isSpan(simulation.unit_krw) && isSpan(simulation.total_krw)) {
            record.price = {
                currency: 'KRW',
                quantity: simulation.quantity,
                unit_price: { min: simulation.unit_krw.low, max: simulation.unit_krw.high },
                total_price: { min: simulation.total_krw.low, max: simulation.total_krw.high }
            };
        }
        return JSON.parse(JSON.stringify(record));
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
        if (!body || body.getAttribute('data-estimate-page') !== PAGE || !screen || !stepTwo || !photoApi || !flow || !config || typeof globalThis.fetch !== 'function') {
            return;
        }

        var frameSelect = byId('resultFrame');
        var lensSelect = byId('resultLens');
        var quantityInput = byId('resultQuantity');
        var editButton = byId('resultEditBtn');
        var nextButton = byId('nextBtn2');
        var sequence = 0;
        var costTimer = null;
        var editing = false;
        var recognised = { frame: 'unknown', lens: 'unknown', mirror: false, gradient: false, photochromic: false };
        var analysisNow = null;
        var lastSimulation = null;

        function box(name) {
            return byId(name);
        }

        function options() {
            var chosen = {};
            OPTIONS.forEach(function (option) {
                var input = box(option[1]);
                chosen[option[0]] = !!(input && input.checked);
            });
            return chosen;
        }

        function optionsText(chosen) {
            var names = OPTIONS.filter(function (option) { return chosen[option[0]]; }).map(function (option) { return option[2]; });
            return names.length ? names.join(', ') : TEXTS.noOptions;
        }

        function spec() {
            var chosen = options();
            return readSpec({
                frame: frameSelect.value,
                lens: lensSelect.value,
                mirror: chosen.mirror,
                gradient: chosen.gradient,
                photochromic: chosen.photochromic,
                quantity: parseQuantity(quantityInput.value) || DEFAULT_QUANTITY
            });
        }

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

        function updateTexts() {
            [[frameSelect, 'resultFrameText'], [lensSelect, 'resultLensText']].forEach(function (pair) {
                pair[0].hidden = !editing;
                setText(pair[1], labelOf(pair[0], pair[0].value));
                setHidden(pair[1], editing);
            });
            var chosen = options();
            setText('resultOptionsText', optionsText(chosen));
            setHidden('resultOptionsText', editing);
            setHidden('resultOptions', !editing);
            var changed = frameSelect.value !== recognised.frame || lensSelect.value !== recognised.lens ||
                OPTIONS.some(function (option) { return chosen[option[0]] !== recognised[option[0]]; });
            setText('resultRecognitionNote', changed ? TEXTS.edited : TEXTS.recognised);
            if (editButton) {
                editButton.textContent = editing ? '수정 완료' : '수정하기';
                editButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
            }
        }

        // ---- the cost
        function showCost(result, wanted) {
            var table = byId('resultCostTable');
            if (result.kind !== 'cost') {
                table.hidden = true;
                setText('resultCostStatus', result.kind === 'busy' ? TEXTS.busy : TEXTS.failed);
                setText('resultNotice', '');
                setHidden('resultAssumptions', true);
                setHidden('resultReference', true);
                return;
            }
            var simulation = result.simulation;
            lastSimulation = simulation;
            setText('resultCostStatus', '');
            setText('resultCostFrameName', labelOf(frameSelect, wanted.frame));
            setText('resultCostLensName', labelOf(lensSelect, wanted.lens) + ' · 기능: ' + optionsText(wanted));
            setText('resultCostFrame', formatSpan(simulation.frame_cost));
            setText('resultCostLens', formatSpan(simulation.lens_cost));
            setText('resultCostOther', formatUsd(simulation.other_cost));
            setText('resultCostUnit', formatSpan(simulation.unit_cost) + (isSpan(simulation.unit_krw) ? ' (약 ' + formatSpan(simulation.unit_krw, formatWon) + ')' : ''));
            setText('resultCostTotal', formatSpan(simulation.total_cost) + (isSpan(simulation.total_krw) ? ' (약 ' + formatSpan(simulation.total_krw, formatWon) + ')' : ''));
            table.hidden = false;
            fillList('resultAssumptions', null, result.assumptions);
            setHidden('resultAssumptions', result.assumptions.length === 0);
            setText('resultNotice', result.notice);
            if (result.reference) {
                setText('resultReference', TEXTS.reference + formatSpan({ low: result.reference.low, high: result.reference.high }) +
                    '입니다. ' + (nonEmpty(result.reference.notice) ? result.reference.notice : ''));
            }
            setHidden('resultReference', !result.reference);
        }

        async function refreshCost() {
            sequence += 1;
            var mine = sequence;
            var wanted = spec();
            setText('resultCostStatus', TEXTS.calculating);
            var result;
            var request = new AbortController();
            var timer = setTimeout(function () { request.abort(); }, COST_TIMEOUT_MS);
            try {
                var response = await globalThis.fetch(joinUrl(config.API_BASE, '/api/estimate-preview/sunglasses-cost'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(wanted),
                    signal: request.signal
                });
                var answer;
                try {
                    answer = await response.json();
                } catch (parseError) {
                    answer = undefined;
                }
                result = interpretCost(response.status, answer);
            } catch (error) {
                result = { kind: 'failed' };
            } finally {
                clearTimeout(timer);
            }
            // An answer for a value that was changed again meanwhile is dropped.
            if (mine === sequence) {
                showCost(result, wanted);
            }
        }

        function later() {
            if (costTimer) {
                clearTimeout(costTimer);
            }
            costTimer = setTimeout(refreshCost, COST_DELAY_MS);
        }

        // ---- the texts of the analysis
        function showAnalysis(analysis) {
            var overview = nonEmpty(analysis.overview) ? analysis.overview : '';
            setText('resultOverview', overview);
            setHidden('resultOverviewBox', overview === '');
            var level = COMPLEXITY[analysis.complexity];
            setText('resultComplexity', level ? '복잡도 · ' + level : '');
            setHidden('resultComplexity', !level);

            var shape = nonEmpty(analysis.frame_shape) ? analysis.frame_shape : '';
            setText('resultShape', shape);
            setHidden('resultShapeRow', shape === '');

            var details = analysis.details && typeof analysis.details === 'object' ? analysis.details : null;
            setText('resultDetailFrame', details && nonEmpty(details.frame) ? details.frame : '');
            setText('resultDetailLens', details && nonEmpty(details.lens) ? details.lens : '');
            setText('resultDetailDecoration', details && nonEmpty(details.decoration) ? details.decoration : '');
            setHidden('resultDetailsBox', !details);

            fillList('resultUnconfirmed', 'resultUnconfirmedBox', analysis.unconfirmed);
            fillList('resultFactors', 'resultFactorsBox', analysis.cost_factors);
            fillList('resultRecommendations', 'resultRecommendBox', analysis.recommendations);
        }

        function selectOr(select, value) {
            select.value = value;
            if (select.value !== value) {
                select.value = 'unknown';
            }
            return select.value;
        }

        function show() {
            var photo = photoApi.getPhoto();
            if (!photo.analysis) {
                return;
            }
            var analysis = photo.analysis;
            analysisNow = analysis;
            lastSimulation = null;
            recognised = {
                frame: selectOr(frameSelect, typeof analysis.frame === 'string' ? analysis.frame : 'unknown'),
                lens: selectOr(lensSelect, typeof analysis.lens === 'string' ? analysis.lens : 'unknown'),
                mirror: analysis.mirror === true,
                gradient: analysis.gradient === true,
                photochromic: analysis.photochromic === true
            };
            OPTIONS.forEach(function (option) {
                var input = box(option[1]);
                if (input) {
                    input.checked = recognised[option[0]];
                }
            });
            quantityInput.value = String(DEFAULT_QUANTITY);
            editing = false;
            showPhoto(photo.file);
            showAnalysis(analysis);
            updateTexts();
            activate();
            refreshCost();
        }

        [frameSelect, lensSelect].concat(OPTIONS.map(function (option) { return box(option[1]); })).forEach(function (input) {
            if (input) {
                input.addEventListener('change', function () {
                    updateTexts();
                    later();
                });
            }
        });
        quantityInput.addEventListener('input', function () {
            if (parseQuantity(quantityInput.value) === null) {
                setText('resultCostStatus', TEXTS.quantity);
                return;
            }
            later();
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
            setText('step2Title', isSpec ? TEXTS.specTitle : TEXTS.photoTitle);
            setText('step2Description', isSpec ? TEXTS.specDescription : TEXTS.photoDescription);
            nextButton.textContent = isSpec ? '다음 단계' : 'AI 견적 시작';
            nextButton.disabled = isSpec ? false : !photoApi.getPhoto().analysis;
        }

        // What was recognised (or chosen on the result) goes into the specification, never over a value the customer chose.
        function fillSpecification() {
            var chosen = options();
            var values = specValues(frameSelect.value, lensSelect.value, chosen);
            var pairs = [['frameMaterial', values.frameMaterial], ['lensType', values.lensType]];
            if (analysisNow && nonEmpty(analysisNow.frame_color)) {
                pairs.push(['frameColor', analysisNow.frame_color]);
            }
            pairs.forEach(function (pair) {
                var target = byId(pair[0]);
                var value = pair[1];
                if (!target || !value || (target.value && !target.hasAttribute('data-ai-filled'))) {
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
            var quantity = parseQuantity(quantityInput.value) || DEFAULT_QUANTITY;
            setText('quantityHint', 'AI 견적은 ' + quantity.toLocaleString('ko-KR') + '개 기준으로 계산했습니다.');
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
        api.getAiPreview = function () {
            return analysisNow ? buildAiPreview(analysisNow, lastSimulation) : null;
        };
    }

    var api = {
        init: init,
        show: null,
        getAiPreview: function () { return null; },
        buildAiPreview: buildAiPreview,
        readSpec: readSpec,
        parseQuantity: parseQuantity,
        interpretCost: interpretCost,
        specValues: specValues,
        formatSpan: formatSpan,
        TEXTS: TEXTS
    };
    globalThis.BridgePathSunglassesResult = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
