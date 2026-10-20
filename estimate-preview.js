// What the sunglasses form needs from the API besides the request itself.
//
// A photo of the product can be put in step 2: it is sent to POST /api/estimate-preview/analyze-image,
// and the frame material and lens type it shows are put into the two selects (never over a choice
// the visitor made). The whole analysis is kept here for the result screen (estimate-result.js),
// which also asks for the price range through requestPreview() when the visitor starts the quote.
//
// Nothing here blocks the request form: if the photo analysis cannot be had, a short line says so
// and the visitor goes on. Nothing is stored. The price range is asked with the lens, the material
// and the quantity only; the analysis sends only the photo (no contact data, no free text). Texts
// are put in with textContent; no value of the form or of the answer goes into markup.
(function () {
    'use strict';

    var PAGE = 'sunglasses';
    var DEFAULT_CATEGORY = 'sunglasses';
    var TIMEOUT_MS = 15000;
    var MAX_QUANTITY = 1000000;

    var MESSAGES = Object.freeze({
        loading: '예상 가격을 계산하고 있어요…',
        unavailable: '이 조건은 예상 가격을 바로 안내하기 어려워요. 정식 견적을 요청하시면 담당자가 확인해 드려요.',
        busy: '요청이 많아 잠시 후 다시 확인해 주세요. 정식 견적 요청은 그대로 진행할 수 있어요.',
        failed: '예상 가격을 불러오지 못했어요. 정식 견적 요청은 그대로 진행할 수 있어요.',
        notice: '입력하신 정보로 계산한 예상 범위이며 확정 견적이 아닙니다. 정식 견적은 담당자가 확인한 뒤 안내드립니다.'
    });

    var IMAGE_MESSAGES = Object.freeze({
        analyzing: '사진을 분석하고 있어요…',
        not_sunglasses: '선글라스 사진으로 보이지 않아요. 다른 사진을 올리거나 재질과 렌즈를 직접 선택해 주세요.',
        nothing_certain: '사진만으로는 재질과 렌즈를 알 수 없었어요. 직접 선택해 주세요.',
        type: 'JPG, PNG, GIF 사진만 분석할 수 있어요. 재질과 렌즈는 직접 선택해도 돼요.',
        too_large: '사진은 5MB까지 분석할 수 있어요. 재질과 렌즈는 직접 선택해도 돼요.',
        unavailable: '사진 분석은 아직 사용할 수 없어요. 재질과 렌즈를 직접 선택해 주세요.',
        busy: '요청이 많아 잠시 후 다시 시도해 주세요. 재질과 렌즈는 직접 선택해도 돼요.',
        failed: '사진을 분석하지 못했어요. 재질과 렌즈를 직접 선택해 주세요.'
    });
    var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
    var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    var IMAGE_TIMEOUT_MS = 45000;
    // Photos from a phone or a camera are often far larger than the analysis needs: anything over
    // 1 MB is scaled down in the browser (long edge 1600 px, JPEG) before it is sent.
    var RESIZE_ABOVE_BYTES = 1024 * 1024;
    var RESIZE_MAX_EDGE = 1600;
    var RESIZE_QUALITY = 0.85;

    // ------------------------------------------------------------------------------------------
    // Pure helpers

    // "500" -> 500. Anything that is not a whole number from 1 to 1,000,000 is not a quantity yet.
    function parseQuantity(raw) {
        var text = String(raw === undefined || raw === null ? '' : raw).trim();
        if (!/^\d{1,7}$/.test(text)) {
            return null;
        }
        var number = Number(text);
        return number >= 1 && number <= MAX_QUANTITY ? number : null;
    }

    // The body of the price request, or null while the three values are not all given.
    function readInput(values, subtype) {
        var material = values && typeof values.frameMaterial === 'string' ? values.frameMaterial : '';
        var lens = values && typeof values.lensType === 'string' ? values.lensType : '';
        var quantity = parseQuantity(values ? values.quantity : '');
        if (!material || !lens || quantity === null) {
            return null;
        }
        return {
            category: subtype || DEFAULT_CATEGORY,
            material: material,
            lens_type: lens,
            quantity: quantity
        };
    }

    function formatWon(amount) {
        return Number(amount).toLocaleString('ko-KR') + '원';
    }

    function formatRange(range) {
        return formatWon(range.min) + ' ~ ' + formatWon(range.max);
    }

    function joinUrl(apiBase, path) {
        return String(apiBase || '').replace(/\/+$/, '') + path;
    }

    function buildRequest(apiBase, input) {
        return {
            url: joinUrl(apiBase, '/api/estimate-preview'),
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(input)
            }
        };
    }

    function isRange(value) {
        return !!value && typeof value.min === 'number' && typeof value.max === 'number';
    }

    // What to show for an answer of the server: { kind: 'range' | 'unavailable' | 'busy' | 'failed' }.
    function interpret(status, body) {
        if (status === 429) {
            return { kind: 'busy' };
        }
        if (status !== 200 || !body || typeof body !== 'object') {
            return { kind: 'failed' };
        }
        var notice = typeof body.notice === 'string' && body.notice ? body.notice : MESSAGES.notice;
        if (body.available === true && isRange(body.unit_price) && isRange(body.total_price)) {
            return { kind: 'range', unit: body.unit_price, total: body.total_price, quantity: body.quantity, notice: notice };
        }
        if (body.available === false) {
            return { kind: 'unavailable', notice: notice };
        }
        return { kind: 'failed' };
    }

    // Asks for the price range; always answers with interpret()'s result, never with an exception.
    // `fetch` is passed in (window.fetch in the page, a fake in the tests).
    async function requestPreview(options) {
        var request = buildRequest(options.apiBase, options.input);
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
        try {
            var response = await options.fetch(request.url, Object.assign({}, request.init, { signal: controller.signal }));
            var body;
            try {
                body = await response.json();
            } catch (parseError) {
                body = undefined;
            }
            return interpret(response.status, body);
        } catch (error) {
            return { kind: 'failed' };
        } finally {
            clearTimeout(timer);
        }
    }

    // ------------------------------------------------------------------------------------------
    // The photo

    // The file is not sent when it cannot be analysed anyway: { ok: true } or { ok: false, kind }.
    function checkImage(file) {
        if (!file || IMAGE_TYPES.indexOf(file.type) === -1) {
            return { ok: false, kind: 'type' };
        }
        if (file.size > MAX_IMAGE_BYTES) {
            return { ok: false, kind: 'too_large' };
        }
        return { ok: true };
    }

    // A smaller JPEG of a large photo, or the photo itself when it is small or cannot be scaled
    // (no canvas, a file the browser cannot decode): the 5 MB limit is then checked on what is left.
    async function prepareImage(file) {
        if (file.size <= RESIZE_ABOVE_BYTES || typeof globalThis.createImageBitmap !== 'function') {
            return file;
        }
        try {
            var bitmap = await globalThis.createImageBitmap(file);
            var scale = Math.min(1, RESIZE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            var context = canvas.getContext('2d');
            if (!context) {
                return file;
            }
            // JPEG has no transparency: a transparent PNG would turn black.
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            if (typeof bitmap.close === 'function') {
                bitmap.close();
            }
            var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', RESIZE_QUALITY); });
            if (!blob || blob.size >= file.size) {
                return file;
            }
            return new File([blob], String(file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
        } catch (error) {
            return file;
        }
    }

    // What to do with the answer: { kind: 'analysis', analysis, notice } or { kind: <message key> }.
    function interpretAnalysis(status, body) {
        if (status === 429) {
            return { kind: 'busy' };
        }
        if (status === 503) {
            return { kind: 'unavailable' };
        }
        if (status === 413) {
            return { kind: 'too_large' };
        }
        var analysis = body && typeof body === 'object' ? body.analysis : null;
        if (status !== 200 || !analysis || typeof analysis.is_sunglasses !== 'boolean') {
            return { kind: 'failed' };
        }
        if (!analysis.is_sunglasses) {
            return { kind: 'not_sunglasses' };
        }
        var notice = typeof body.notice === 'string' && body.notice ? body.notice : '';
        return { kind: 'analysis', analysis: analysis, notice: notice };
    }

    function createImageAnalysis(options) {
        var statusLine = options.statusLine;
        var materialSelect = options.materialSelect;
        var lensSelect = options.lensSelect;
        var controller = null;
        var sequence = 0;
        // The selects this script has filled; a value the visitor chose is never replaced.
        var filled = { material: false, lens: false };
        // The photo that was analysed and what came out, for the result screen.
        var current = { file: null, analysis: null };

        function say(text) {
            statusLine.hidden = !text;
            statusLine.textContent = text || '';
        }

        function labelOf(select, value) {
            for (var i = 0; i < select.options.length; i += 1) {
                if (select.options[i].value === value) {
                    return select.options[i].textContent;
                }
            }
            return value;
        }

        // Puts a value into a select unless the visitor chose one; true when it did.
        function fill(select, key, value) {
            if (value === 'unknown' || (select.value && !filled[key])) {
                return false;
            }
            select.value = value;
            filled[key] = true;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return select.value === value;
        }

        // A choice the visitor makes after a fill takes the select back. The fill's own change
        // event is dispatched while `filling` is set, so it is told apart from the visitor's.
        var filling = false;
        function takeBack(key) {
            return function () {
                if (!filling) {
                    filled[key] = false;
                }
            };
        }
        materialSelect.addEventListener('change', takeBack('material'));
        lensSelect.addEventListener('change', takeBack('lens'));

        function showAnalysis(result) {
            var analysis = result.analysis;
            filling = true;
            var materialDone = fill(materialSelect, 'material', analysis.frame_material);
            var lensDone = fill(lensSelect, 'lens', analysis.lens_type);
            filling = false;
            var found = [];
            if (materialDone) {
                found.push('재질: ' + labelOf(materialSelect, analysis.frame_material));
            }
            if (lensDone) {
                found.push('렌즈: ' + labelOf(lensSelect, analysis.lens_type));
            }
            var text = typeof analysis.summary === 'string' ? analysis.summary : '';
            if (found.length > 0) {
                text += (text ? ' ' : '') + '(' + found.join(', ') + ' 자동 선택)';
            } else if (analysis.frame_material === 'unknown' && analysis.lens_type === 'unknown') {
                text += (text ? ' ' : '') + IMAGE_MESSAGES.nothing_certain;
            }
            say(text + (result.notice ? ' ' + result.notice : ''));
        }

        async function analyse(file) {
            if (controller) {
                controller.abort();
                controller = null;
            }
            sequence += 1;
            var mine = sequence;
            // A new choice of photo drops what the old one gave.
            current = { file: null, analysis: null };

            if (!file) {
                say('');
                return;
            }
            // The type is checked first: a PDF is never decoded or scaled.
            var checked = checkImage(file);
            if (checked.ok || checked.kind === 'too_large') {
                say(IMAGE_MESSAGES.analyzing);
                file = await prepareImage(file);
                if (mine !== sequence) {
                    return;
                }
                checked = checkImage(file);
            }
            if (!checked.ok) {
                say(IMAGE_MESSAGES[checked.kind]);
                return;
            }

            say(IMAGE_MESSAGES.analyzing);
            var request = new AbortController();
            controller = request;
            var timedOut = setTimeout(function () { request.abort(); }, IMAGE_TIMEOUT_MS);
            var result;
            try {
                var form = new FormData();
                form.append('image', file);
                var response = await options.fetch(joinUrl(options.apiBase, '/api/estimate-preview/analyze-image'), {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body: form,
                    signal: request.signal
                });
                var body;
                try {
                    body = await response.json();
                } catch (parseError) {
                    body = undefined;
                }
                result = interpretAnalysis(response.status, body);
            } catch (error) {
                result = { kind: 'failed' };
            } finally {
                clearTimeout(timedOut);
            }
            // An answer for a photo that has been replaced meanwhile is dropped without a word.
            if (mine !== sequence) {
                return;
            }
            controller = null;
            if (result.kind === 'analysis') {
                current = { file: file, analysis: result.analysis };
                showAnalysis(result);
            } else {
                say(IMAGE_MESSAGES[result.kind]);
            }
        }

        // The last photo that was analysed with success: { file, analysis } (both null otherwise).
        function getCurrent() {
            return current;
        }

        return { analyse: analyse, getCurrent: getCurrent };
    }

    // The photo state of the page, for the result screen; empty until a photo has been analysed.
    var photo = null;

    function init() {
        var body = document.body;
        if (!body || body.getAttribute('data-estimate-page') !== PAGE) {
            return;
        }
        var config = globalThis.BridgePathConfig;
        var imageInput = document.getElementById('sunglassImage');
        var imageStatus = document.getElementById('imageAnalysisStatus');
        var materialSelect = document.getElementById('frameMaterial');
        var lensSelect = document.getElementById('lensType');
        if (!config || typeof globalThis.fetch !== 'function' || !imageInput || !imageStatus || !materialSelect || !lensSelect) {
            return;
        }

        photo = createImageAnalysis({
            statusLine: imageStatus,
            materialSelect: materialSelect,
            lensSelect: lensSelect,
            apiBase: config.API_BASE,
            fetch: function (url, init) { return globalThis.fetch(url, init); }
        });
        imageInput.addEventListener('change', function () {
            photo.analyse(imageInput.files && imageInput.files[0]);
        });
    }

    var api = Object.freeze({
        MESSAGES: MESSAGES,
        parseQuantity: parseQuantity,
        readInput: readInput,
        formatRange: formatRange,
        buildRequest: buildRequest,
        interpret: interpret,
        requestPreview: requestPreview,
        checkImage: checkImage,
        prepareImage: prepareImage,
        interpretAnalysis: interpretAnalysis,
        createImageAnalysis: createImageAnalysis,
        getPhoto: function () { return photo ? photo.getCurrent() : { file: null, analysis: null }; },
        init: init
    });

    globalThis.BridgePathPreview = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
