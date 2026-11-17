// The photo of the golf shoe page (step 2): a photo of the shoe is sent to POST /api/estimate-preview/analyze-golf-shoe. When it
// shows a golf shoe, "AI 견적 시작" is ready and the analysis is kept for the result screen (golf-shoe-result.js); the visitor enters
// no specification here: that is asked only in the detailed quote (signed-in customers), after the result.
//
// Nothing here blocks anything else: when the analysis cannot be had, a short line says so and the visitor can try another photo.
// Nothing is stored; the analysis sends only the photo (no contact data, no free text). The photo checks and the scaling of a
// large photo are those of estimate-preview.js (BridgePathPreview). Texts are put in with textContent.
(function () {
    'use strict';

    var PAGE = 'shoes';
    var IMAGE_TIMEOUT_MS = 45000;
    // when the line under the upload box moves on while the photo is being analysed (the analysis takes ten seconds or more)
    var STAGE_MORE_MS = 4000;
    var STAGE_LONG_MS = 12000;

    var MESSAGES = Object.freeze({
        analyzing: '사진을 분석하고 있습니다…',
        analyzingMore: '조임 방식과 아웃솔, 재질을 추정하고 있습니다…',
        analyzingLong: '거의 끝났습니다. 조금만 기다려 주세요…',
        done: '사진 분석이 끝났습니다. 아래 ‘AI 견적 시작’을 눌러 결과를 확인하세요.',
        not_golf_shoe: '골프화 사진으로 보이지 않습니다. 골프화가 잘 보이는 다른 사진을 올려 주세요.',
        type: 'JPG, PNG, WEBP 사진만 분석할 수 있습니다.',
        too_large: '사진은 5MB까지 분석할 수 있습니다.',
        unavailable: '사진 분석은 아직 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        busy: '요청이 많아 잠시 후 다시 시도해 주세요.',
        failed: '사진을 분석하지 못했습니다. 다른 사진으로 다시 시도해 주세요.'
    });

    function joinUrl(apiBase, path) {
        return String(apiBase || '').replace(/\/+$/, '') + path;
    }

    // What to do with the answer of the analysis: { kind: 'analysis', analysis } or { kind: <message key> }.
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
        if (status !== 200 || !analysis || typeof analysis.is_golf_shoe !== 'boolean') {
            return { kind: 'failed' };
        }
        if (!analysis.is_golf_shoe) {
            return { kind: 'not_golf_shoe' };
        }
        return { kind: 'analysis', analysis: analysis };
    }

    // The photo that was analysed is attached to the request (estimate-attachments.js), where the customer can take it out again.
    function setAttached(file) {
        var attachments = globalThis.BridgePathAttachments;
        if (attachments && attachments.instance && typeof attachments.instance.setAutoFile === 'function') {
            attachments.instance.setAutoFile(file);
        }
    }

    function create(options) {
        var preview = options.preview;
        var statusLine = options.statusLine;
        var startButton = options.startButton;
        var controller = null;
        var sequence = 0;
        // The photo that was analysed with success and what came out, for the result screen.
        var current = { file: null, analysis: null };

        // state: 'busy' while the photo is analysed, 'error' when it could not be, 'done' otherwise
        function say(text, state) {
            statusLine.hidden = !text;
            statusLine.textContent = text || '';
            if (text) {
                statusLine.setAttribute('data-state', state || 'done');
            } else {
                statusLine.removeAttribute('data-state');
            }
        }

        async function analyse(file) {
            if (controller) {
                controller.abort();
                controller = null;
            }
            sequence += 1;
            var mine = sequence;
            // A new choice of photo drops what the old one gave, and the old photo leaves the attachments.
            current = { file: null, analysis: null };
            startButton.disabled = true;
            setAttached(null);

            if (!file) {
                say('');
                return;
            }
            // The type is checked first: a PDF is never decoded or scaled.
            var checked = preview.checkImage(file);
            if (checked.ok || checked.kind === 'too_large') {
                say(MESSAGES.analyzing, 'busy');
                file = await preview.prepareImage(file);
                if (mine !== sequence) {
                    return;
                }
                checked = preview.checkImage(file);
            }
            if (!checked.ok) {
                say(MESSAGES[checked.kind], 'error');
                return;
            }

            // The photo goes with the request whatever the analysis says: the customer chose it.
            setAttached(file);
            say(MESSAGES.analyzing, 'busy');
            var request = new AbortController();
            controller = request;
            var timedOut = setTimeout(function () { request.abort(); }, IMAGE_TIMEOUT_MS);
            var moreTimer = setTimeout(function () { if (mine === sequence) { say(MESSAGES.analyzingMore, 'busy'); } }, STAGE_MORE_MS);
            var longTimer = setTimeout(function () { if (mine === sequence) { say(MESSAGES.analyzingLong, 'busy'); } }, STAGE_LONG_MS);
            var result;
            try {
                var form = new FormData();
                form.append('image', file);
                var response = await options.fetch(joinUrl(options.apiBase, '/api/estimate-preview/analyze-golf-shoe'), {
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
                clearTimeout(moreTimer);
                clearTimeout(longTimer);
            }
            // An answer for a photo that has been replaced meanwhile is dropped without a word.
            if (mine !== sequence) {
                return;
            }
            controller = null;
            if (result.kind === 'analysis') {
                current = { file: file, analysis: result.analysis };
                startButton.disabled = false;
                say(MESSAGES.done);
            } else {
                say(MESSAGES[result.kind], 'error');
            }
        }

        return { analyse: analyse, getCurrent: function () { return current; } };
    }

    var photo = null;

    function init() {
        var body = document.body;
        if (!body || body.getAttribute('data-estimate-page') !== PAGE) {
            return;
        }
        var config = globalThis.BridgePathConfig;
        var preview = globalThis.BridgePathPreview;
        var input = document.getElementById('shoeImage');
        var statusLine = document.getElementById('imageAnalysisStatus');
        var startButton = document.getElementById('nextBtn2');
        if (!config || !preview || !input || !statusLine || !startButton || typeof globalThis.fetch !== 'function') {
            return;
        }

        photo = create({
            preview: preview,
            statusLine: statusLine,
            startButton: startButton,
            apiBase: config.API_BASE,
            fetch: function (url, init) { return globalThis.fetch(url, init); }
        });
        // "AI 견적 시작" waits for a golf shoe photo that was analysed.
        startButton.disabled = true;
        input.addEventListener('change', function () {
            photo.analyse(input.files && input.files[0]);
        });
    }

    var api = Object.freeze({
        MESSAGES: MESSAGES,
        interpretAnalysis: interpretAnalysis,
        getPhoto: function () { return photo ? photo.getCurrent() : { file: null, analysis: null }; },
        init: init
    });

    globalThis.BridgePathGolfShoePhoto = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
