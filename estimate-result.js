// The result screen of the sunglasses quote, shown when the visitor presses "AI 견적 시작" in step 2
// (estimate-flow.js calls BridgePathResult.show() once the product input is valid).
//
// It shows what was recognised (from the photo analysis kept by estimate-preview.js, or from the
// form alone when there was no photo), the price range asked from POST /api/estimate-preview, and
// the analysis texts of the photo. "수정하기" goes back to step 2; "정식 견적 요청하기" goes on to step 3,
// where the request itself is sent. The range is guidance only: the server's notice says so.
//
// What the screen showed is kept for the request (getAiPreview): the analysis of the photo and the
// price range, as a record of what the customer saw. The server checks its shape and never takes it
// for a quote.
//
// Nothing here stores anything. Every text is put in with textContent and every list item is a
// new element; no value of the form or of an answer goes into markup.
(function () {
    'use strict';

    var PAGE = 'sunglasses';

    var COMPLEXITY = Object.freeze({ low: '낮음', medium: '중간', high: '높음' });

    var TEXTS = Object.freeze({
        recognised_from_photo: 'AI가 업로드한 사진을 분석한 결과예요. 실제와 다르면 ‘수정하기’에서 고쳐 다시 계산할 수 있어요.',
        edited: '사진 분석 결과와 다르게 직접 고르신 값으로 계산했어요.',
        from_form: '입력하신 값으로 계산했어요. 사진을 올리면 AI가 형태와 비용 요인도 분석해 드려요.',
        calculating: '예상 비용을 계산하고 있어요…',
        unknown: '잘 모르겠음'
    });

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
        if (!select) {
            return value;
        }
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

    var photoUrl = null;

    // ------------------------------------------------------------------------------------------
    // The record of the screen (specification_json.ai_preview, checked by utils/specification.ts)

    var ENUMS = {
        frame_material: ['plastic', 'metal', 'acetate', 'wood', 'mixed', 'unknown'],
        lens_type: ['normal', 'polarized', 'mirror', 'gradient', 'photochromic', 'unknown'],
        confidence: ['low', 'medium', 'high'],
        complexity: ['low', 'medium', 'high']
    };

    function clip(value, max) {
        return typeof value === 'string' ? value.trim().slice(0, max) : '';
    }

    function clipList(items) {
        return Array.isArray(items)
            ? items.filter(nonEmpty).slice(0, 4).map(function (item) { return clip(item, 200); })
            : [];
    }

    // Only what the server's shape allows, cut to its limits; nothing else of the answer is passed on.
    function recordAnalysis(analysis) {
        if (!analysis || typeof analysis !== 'object') {
            return null;
        }
        var record = {};
        Object.keys(ENUMS).forEach(function (key) {
            if (ENUMS[key].indexOf(analysis[key]) !== -1) {
                record[key] = analysis[key];
            }
        });
        [['frame_shape', 100], ['frame_color', 100], ['overview', 1000]].forEach(function (pair) {
            var text = clip(analysis[pair[0]], pair[1]);
            if (text) {
                record[pair[0]] = text;
            }
        });
        if (analysis.details && typeof analysis.details === 'object') {
            record.details = {
                frame: clip(analysis.details.frame, 300),
                lens: clip(analysis.details.lens, 300),
                decoration: clip(analysis.details.decoration, 300)
            };
        }
        record.cost_factors = clipList(analysis.cost_factors);
        record.recommendations = clipList(analysis.recommendations);
        return record;
    }

    function recordPrice(result) {
        if (!result || result.kind !== 'range') {
            return null;
        }
        return {
            currency: 'KRW',
            quantity: result.quantity,
            unit_price: { min: result.unit.min, max: result.unit.max },
            total_price: { min: result.total.min, max: result.total.max }
        };
    }

    // The last screen that was shown: { analysis, price }, or null before the first one.
    var shown = null;

    function getAiPreview() {
        if (!shown) {
            return null;
        }
        var analysis = recordAnalysis(shown.analysis);
        var price = shown.price;
        if (!analysis && !price) {
            return null;
        }
        var record = { source: 'customer_screen' };
        if (analysis) {
            record.analysis = analysis;
        }
        if (price) {
            record.price = price;
        }
        return record;
    }

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

    // The parts that come from the photo analysis; all hidden when there was none.
    function showAnalysis(analysis, values) {
        var has = !!analysis;
        setHidden('resultOverviewBox', !(has && nonEmpty(analysis.overview)));
        setText('resultOverview', has && nonEmpty(analysis.overview) ? analysis.overview : '');
        setText('resultComplexity', has && COMPLEXITY[analysis.complexity] ? '복잡도 · ' + COMPLEXITY[analysis.complexity] : '');
        setHidden('resultComplexity', !(has && COMPLEXITY[analysis.complexity]));

        setText('resultShape', has && nonEmpty(analysis.frame_shape) ? analysis.frame_shape : '');
        setHidden('resultShapeRow', !(has && nonEmpty(analysis.frame_shape)));
        setText('resultColor', has && nonEmpty(analysis.frame_color) ? analysis.frame_color : '');
        setHidden('resultColorRow', !(has && nonEmpty(analysis.frame_color)));

        var details = has && analysis.details && typeof analysis.details === 'object' ? analysis.details : null;
        setText('resultDetailFrame', details && nonEmpty(details.frame) ? details.frame : '');
        setText('resultDetailLens', details && nonEmpty(details.lens) ? details.lens : '');
        setText('resultDetailDecoration', details && nonEmpty(details.decoration) ? details.decoration : '');
        setHidden('resultDetailsBox', !details);

        fillList('resultFactors', 'resultFactorsBox', has ? analysis.cost_factors : []);
        fillList('resultRecommendations', 'resultRecommendBox', has ? analysis.recommendations : []);

        var note = TEXTS.from_form;
        if (has) {
            var changed = (analysis.frame_material !== 'unknown' && analysis.frame_material !== values.frameMaterial) ||
                (analysis.lens_type !== 'unknown' && analysis.lens_type !== values.lensType);
            note = changed ? TEXTS.edited : TEXTS.recognised_from_photo;
        }
        setText('resultRecognitionNote', note);
    }

    function showCost(result) {
        var table = byId('resultCostTable');
        if (result.kind === 'range') {
            setText('resultCostStatus', '');
            setText('resultUnit', formatRange(result.unit));
            setText('resultTotal', formatRange(result.total));
            if (table) {
                table.hidden = false;
            }
            setText('resultNotice', result.notice);
            return;
        }
        if (table) {
            table.hidden = true;
        }
        var messages = globalThis.BridgePathPreview.MESSAGES;
        setText('resultCostStatus', result.kind === 'unavailable' ? messages.unavailable : result.kind === 'busy' ? messages.busy : messages.failed);
        setText('resultNotice', result.kind === 'unavailable' && result.notice ? result.notice : '');
    }

    function formatRange(range) {
        return globalThis.BridgePathPreview.formatRange(range);
    }

    function init() {
        var body = document.body;
        var preview = globalThis.BridgePathPreview;
        var flow = globalThis.BridgePathFlow;
        var config = globalThis.BridgePathConfig;
        var screen = byId('result-content');
        if (!body || body.getAttribute('data-estimate-page') !== PAGE || !screen || !preview || !flow || !config) {
            return;
        }

        var materialSelect = byId('frameMaterial');
        var lensSelect = byId('lensType');
        var sequence = 0;

        function subtype() {
            var card = document.querySelector('.category-card.selected');
            return card ? card.getAttribute('data-category') : '';
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

        async function show() {
            var values = flow.collectValues(PAGE);
            var input = preview.readInput(values, subtype());
            var photo = preview.getPhoto();
            sequence += 1;
            var mine = sequence;
            // What this screen will show; the price is added when it comes.
            shown = { analysis: photo.analysis, price: null };

            setText('resultMaterial', labelOf(materialSelect, values.frameMaterial));
            setText('resultLens', labelOf(lensSelect, values.lensType));
            setText('resultQuantity', input ? input.quantity.toLocaleString('ko-KR') + '개' : values.quantity + '개');
            showPhoto(photo.file);
            showAnalysis(photo.analysis, values);

            // The cost is asked after the screen is up, so the rest is there at once.
            var table = byId('resultCostTable');
            if (table) {
                table.hidden = true;
            }
            setText('resultNotice', '');
            setText('resultCostStatus', TEXTS.calculating);
            activate();

            if (!input) {
                showCost({ kind: 'failed' });
                return;
            }
            var result = await preview.requestPreview({
                apiBase: config.API_BASE,
                input: input,
                fetch: function (url, init) { return globalThis.fetch(url, init); }
            });
            // An answer for a screen that was left and shown again meanwhile is dropped.
            if (mine === sequence) {
                showCost(result);
                shown.price = recordPrice(result);
            }
        }

        // ---- the detailed quote from the staff (for signed-in customers only)
        // A customer who is not signed in logs in or signs up in a new tab (the form and the photo stay
        // on this one); when they come back, the sign-in is noticed and the request goes on.
        var detailedButton = byId('detailedBtn');
        var loginBox = byId('detailedLogin');
        var waitingForLogin = false;
        var checking = false;

        function goOnAsCustomer(customer) {
            waitingForLogin = false;
            if (loginBox) {
                loginBox.hidden = true;
            }
            sequence += 1;
            flow.startDetailed(customer);
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

        var editButton = byId('resultEditBtn');
        if (editButton) {
            editButton.addEventListener('click', function () {
                waitingForLogin = false;
                sequence += 1;
                if (typeof globalThis.goToStep === 'function') {
                    globalThis.goToStep(2);
                }
            });
        }

        var requestButton = byId('resultRequestBtn');
        if (requestButton) {
            requestButton.addEventListener('click', function () {
                waitingForLogin = false;
                flow.setSimple();
                sequence += 1;
                if (typeof globalThis.goToStep === 'function') {
                    globalThis.goToStep(3);
                }
                var heading = document.querySelector('#step3-content h2');
                if (heading) {
                    heading.setAttribute('tabindex', '-1');
                    heading.focus();
                }
            });
        }

        api.show = show;
    }

    var api = { init: init, show: null, getAiPreview: getAiPreview };
    globalThis.BridgePathResult = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
