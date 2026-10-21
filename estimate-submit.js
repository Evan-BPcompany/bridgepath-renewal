// What the estimate pages share to send a request (the three pages with steps and the single page
// of the other products): the errors of the product input, and the controller that checks the
// input, builds the JSON request with BridgePathEstimate, sends it and shows the result.
//
// The request is JSON, or a multipart form when the customer attached files (estimate-api.js builds
// both). Everything that is shown (a message, the receipt number, the text of the server) is put in
// with textContent; there is no innerHTML in this file, nothing is stored, nothing is logged, and
// the page is never left by itself.
(function () {
    'use strict';

    var CUSTOMER_FIELDS = ['customer_type', 'customer_name', 'company_name', 'customer_email', 'customer_phone', 'contact', 'privacy_consent'];

    function api() {
        var estimate = globalThis.BridgePathEstimate;
        if (!estimate) {
            throw new Error('estimate-api.js has to be loaded before estimate-submit.js');
        }
        return estimate;
    }

    function precedes(a, b) {
        return Boolean(a.compareDocumentPosition(b) & 4); // Node.DOCUMENT_POSITION_FOLLOWING
    }

    function formatTime(value) {
        var date = new Date(value);
        if (isNaN(date.getTime())) {
            return value;
        }
        try {
            return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
        } catch (error) {
            return value;
        }
    }

    function alertBox(id) {
        var box = document.createElement('div');
        box.id = id;
        box.className = 'customer-error-summary';
        box.setAttribute('role', 'alert');
        box.setAttribute('tabindex', '-1');
        box.hidden = true;
        return box;
    }

    // The errors of the product input, shown at the controls and in a summary.
    // options: controlsFor(field) -> the elements of an error (the field is the key of the value),
    //          summaryParent / summaryBefore -> where the summary goes,
    //          listenOn -> the element whose input/change events take a message away.
    function createProductErrors(options) {
        var estimate = api();
        var summary = alertBox('productErrorSummary');
        options.summaryParent.insertBefore(summary, options.summaryBefore || null);
        var shown = []; // { elements, box }

        function drop(entry) {
            entry.elements.forEach(function (element) {
                element.removeAttribute('aria-invalid');
                element.removeAttribute('aria-describedby');
            });
            if (entry.box.parentNode) {
                entry.box.parentNode.removeChild(entry.box);
            }
        }

        function refresh() {
            if (shown.length === 0) {
                summary.textContent = '';
                summary.hidden = true;
            } else {
                summary.textContent = '확인이 필요한 항목이 ' + shown.length + '개 있어요.';
                summary.hidden = false;
            }
        }

        function clear() {
            shown.forEach(drop);
            shown = [];
            refresh();
        }

        function show(errors) {
            clear();
            var seen = {};
            var first = null;
            errors.forEach(function (error) {
                if (seen[error.field]) {
                    return;
                }
                seen[error.field] = true;
                var elements = options.controlsFor(error.field);
                if (elements.length === 0) {
                    return;
                }
                var box = document.createElement('p');
                box.id = 'productError-' + error.field;
                box.className = 'field-error';
                box.textContent = estimate.messageFor(error.code, { max: error.max });
                var anchor = elements[0].closest('.form-group') || elements[0].parentNode;
                anchor.appendChild(box);
                elements.forEach(function (element) {
                    element.setAttribute('aria-invalid', 'true');
                    element.setAttribute('aria-describedby', box.id);
                });
                shown.push({ elements: elements, box: box });
                if (!first || precedes(elements[0], first)) {
                    first = elements[0];
                }
            });
            refresh();
            if (first) {
                first.focus();
            } else {
                summary.textContent = '확인이 필요한 항목이 ' + shown.length + '개 있어요.';
                summary.hidden = false;
                summary.focus();
            }
        }

        if (options.listenOn) {
            // A wrong value is cleared as soon as it is changed.
            var clearOn = function (event) {
                var target = event.target;
                shown = shown.filter(function (entry) {
                    if (entry.elements.indexOf(target) === -1) {
                        return true;
                    }
                    drop(entry);
                    return false;
                });
                refresh();
            };
            options.listenOn.addEventListener('input', clearOn);
            options.listenOn.addEventListener('change', clearOn);
        }

        return { show: show, clear: clear };
    }

    // The controller of the request.
    // options: page, getSubtype(), collectValues(), customerStep (BridgePathCustomerStep.mount),
    //          productErrors (createProductErrors), submitButton, successBox,
    //          errorParent / errorBefore -> where the error of the request goes,
    //          lockElements() -> the controls that are locked while the request is on the way,
    //          hideOnSuccess -> elements that are hidden after a success,
    //          onProductInvalid() -> called when the product input is wrong at the moment of sending,
    //          getFiles() -> the files to send with the request (optional),
    //          getExtraSpec() -> values added to the specification, e.g. { ai_preview } (optional),
    //          afterSuccess() -> called once the request has been accepted (optional),
    //          getSummary() -> the rows of the product for the receipt, [{ label, value }] (optional),
    //          getRequestKind() -> 'simple' (default) or 'detailed': a request for a detailed quote from the
    //          staff, which only a signed-in customer may send (optional).
    // Returns { submit }; the caller connects it to the click or the submit event.
    function createSubmitter(options) {
        var estimate = api();
        var config = globalThis.BridgePathConfig || {};
        var submitButton = options.submitButton;
        var label = submitButton.textContent;
        var submitting = false; // also stays true after a success: one request per page
        var locked = [];

        var errorBox = alertBox('submitError');
        options.errorParent.insertBefore(errorBox, options.errorBefore || null);

        // The receipt: the number can be copied, and what was sent is listed (PRD FR-4.5).
        var copyButton = document.getElementById('copyReceipt');
        var copyNote = document.getElementById('copyReceiptNote');
        if (copyButton) {
            copyButton.addEventListener('click', function () {
                var number = document.getElementById('receiptId').textContent;
                var clipboard = globalThis.navigator && globalThis.navigator.clipboard;
                var say = function (text) {
                    if (copyNote) {
                        copyNote.textContent = text;
                    }
                };
                if (!clipboard || typeof clipboard.writeText !== 'function') {
                    say('직접 선택해서 복사해 주세요.');
                    return;
                }
                clipboard.writeText(number).then(
                    function () { say('복사했어요.'); },
                    function () { say('복사하지 못했어요. 직접 선택해서 복사해 주세요.'); }
                );
            });
        }

        function requestKind() {
            return options.getRequestKind && options.getRequestKind() === 'detailed' ? 'detailed' : 'simple';
        }

        function won(amount) {
            return Number(amount).toLocaleString('ko-KR') + '원';
        }

        // The rows of the receipt: the product (from the page), the price range the customer was
        // shown, the contact details and the files. Built before the form is emptied.
        function buildSummary(spec, customer, files) {
            var rows = options.getSummary ? options.getSummary().slice() : [];
            if (requestKind() === 'detailed') {
                rows.unshift({ label: '요청 종류', value: '담당자 상세견적' });
            }
            var price = spec.ai_preview && spec.ai_preview.price;
            if (price && price.unit_price && price.total_price) {
                rows.push({
                    label: '화면에 보인 예상 범위 (참고)',
                    value: '개당 약 ' + won(price.unit_price.min) + ' ~ ' + won(price.unit_price.max) +
                        ', 총 약 ' + won(price.total_price.min) + ' ~ ' + won(price.total_price.max) + ' · 확정 견적이 아니에요'
                });
            }
            var types = estimate.CUSTOMER_TYPES || {};
            [
                ['고객 유형', types[customer.customer_type]],
                ['이름', customer.customer_name],
                ['회사·브랜드', customer.company_name],
                ['이메일', customer.customer_email],
                ['전화', customer.customer_phone]
            ].forEach(function (pair) {
                if (pair[1]) {
                    rows.push({ label: pair[0], value: pair[1] });
                }
            });
            if (files.length > 0) {
                rows.push({ label: '첨부 파일', value: files.map(function (file) { return file.name; }).join(', ') });
            }
            return rows;
        }

        function showSummary(rows) {
            var box = document.getElementById('receiptSummary');
            var list = document.getElementById('receiptSummaryList');
            if (!box || !list) {
                return;
            }
            list.textContent = '';
            rows.forEach(function (row) {
                var term = document.createElement('dt');
                term.textContent = row.label;
                var value = document.createElement('dd');
                value.textContent = row.value;
                list.appendChild(term);
                list.appendChild(value);
            });
            box.hidden = rows.length === 0;
        }

        function showError(text) {
            errorBox.textContent = text;
            errorBox.hidden = false;
            errorBox.focus();
        }

        function setBusy(busy) {
            if (busy) {
                // Only what is enabled now is locked, so that nothing that was disabled is switched on again.
                locked = options.lockElements().filter(function (element) { return !element.disabled; });
                locked.forEach(function (element) { element.disabled = true; });
                submitButton.disabled = true;
                submitButton.setAttribute('aria-busy', 'true');
                submitButton.textContent = '보내는 중…';
            } else {
                locked.forEach(function (element) { element.disabled = false; });
                locked = [];
                submitButton.disabled = false;
                submitButton.removeAttribute('aria-busy');
                submitButton.textContent = label;
            }
        }

        // Only the three things the answer is meant to give are shown, and only as text.
        function showSuccess(result, summary) {
            document.getElementById('receiptId').textContent = result.receiptId;
            showSummary(summary || []);
            if (result.createdAt) {
                document.getElementById('receiptTime').textContent = formatTime(result.createdAt);
                document.getElementById('receiptTimeRow').hidden = false;
            }
            if (result.message) {
                var message = document.getElementById('receiptMessage');
                message.textContent = result.message;
                message.hidden = false;
            }
            errorBox.hidden = true;
            options.customerStep.reset();
            if (options.afterSuccess) {
                options.afterSuccess();
            }
            options.hideOnSuccess.forEach(function (element) { element.style.display = 'none'; });
            options.successBox.style.display = 'block';
            options.successBox.focus();
        }

        function showFailure(result) {
            if (result.kind === 'validation') {
                var mine = result.fieldErrors.filter(function (error) { return CUSTOMER_FIELDS.indexOf(error.field) !== -1; });
                if (mine.length > 0) {
                    options.customerStep.showServerErrors(mine);
                    return;
                }
            }
            showError(estimate.messageForResult(result));
        }

        async function submit() {
            if (submitting) {
                return;
            }
            var subtype = options.getSubtype();
            var built = estimate.buildSpecification(options.page, subtype, options.collectValues());
            if (!built.ok) {
                if (options.onProductInvalid) {
                    options.onProductInvalid();
                }
                options.productErrors.show(built.errors);
            }
            // The focus goes to the product input first; to the customer only when that is right.
            var customer = options.customerStep.validate({ focus: built.ok });
            if (!built.ok || !customer.valid) {
                return;
            }

            // What the page adds to the specification (the record of the AI quote): only what is there.
            var extra = options.getExtraSpec ? options.getExtraSpec() : null;
            var spec = built.spec;
            if (extra) {
                Object.keys(extra).forEach(function (key) {
                    if (extra[key]) {
                        spec[key] = extra[key];
                    }
                });
            }
            var files = options.getFiles ? options.getFiles() : [];
            var summary = buildSummary(spec, customer.value, files);

            submitting = true;
            errorBox.hidden = true;
            setBusy(true);
            var result;
            try {
                var request = estimate.buildRequest({
                    apiBase: config.API_BASE,
                    page: options.page,
                    subtype: subtype,
                    spec: spec,
                    customer: customer.value,
                    consentVersion: config.PRIVACY_CONSENT_VERSION,
                    files: files,
                    requestKind: requestKind()
                });
                result = await estimate.submitEstimate({
                    request: request,
                    fetch: function (url, init) { return globalThis.fetch(url, init); },
                    timeoutMs: config.REQUEST_TIMEOUT_MS,
                    hadFiles: files.length > 0
                });
            } catch (error) {
                result = { kind: 'unexpected' };
            }

            if (result.kind === 'success') {
                submitButton.removeAttribute('aria-busy');
                showSuccess(result, summary);
                return; // `submitting` stays true: one request per page
            }
            // The form is given back first, so that the focus can go to a field.
            setBusy(false);
            submitting = false;
            showFailure(result);
        }

        return { submit: submit };
    }

    var exported = { createProductErrors: createProductErrors, createSubmitter: createSubmitter, formatTime: formatTime };
    globalThis.BridgePathSubmit = exported;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
})();
