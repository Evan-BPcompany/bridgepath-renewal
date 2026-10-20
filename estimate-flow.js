// The three steps of the estimate pages (sunglasses, shoes, golf): the product input of step 2 is
// checked before step 3, and step 3 (customer information) is mounted and checked before the
// page script goes on. Nothing is sent from here.
//
// Messages are put in with textContent; no value of the form goes into innerHTML.
(function () {
    'use strict';

    // The id of the control of each value of the product input, per page.
    var CONTROLS = {
        sunglasses: {
            frameColor: 'frameColor', lensType: 'lensType', frameMaterial: 'frameMaterial', lensColor: 'lensColor',
            quantity: 'quantity', deliveryDate: 'deliveryDate', additionalInfo: 'additionalInfo'
        },
        shoes: {
            material: 'material', color: 'color', quantity: 'quantity', deliveryDate: 'deliveryDate', additionalInfo: 'additionalInfo'
        },
        golf: {
            color: 'productColor', material: 'material', size: 'size', design: 'design', quantity: 'quantity',
            deliveryDate: 'deliveryDate', additionalInfo: 'additionalInfo'
        }
    };

    function pageKey() {
        var key = document.body.getAttribute('data-estimate-page');
        return Object.prototype.hasOwnProperty.call(CONTROLS, key) ? key : '';
    }

    function sizeBoxes() {
        return Array.prototype.slice.call(document.querySelectorAll('#step2-content input[name="size"]'));
    }

    // The subtype is the card of step 1 that is selected.
    function selectedSubtype() {
        var card = document.querySelector('.category-card.selected');
        return card ? card.getAttribute('data-category') : '';
    }

    function collectValues(page) {
        var values = {};
        var ids = CONTROLS[page];
        Object.keys(ids).forEach(function (key) {
            var element = document.getElementById(ids[key]);
            values[key] = element ? element.value : '';
        });
        if (page === 'shoes') {
            values.sizes = sizeBoxes().filter(function (box) { return box.checked; }).map(function (box) { return box.value; });
        }
        return values;
    }

    // The elements that belong to an error of the product input: the field name is the key of the value.
    function controlsFor(page, field) {
        if (field === 'sizes') {
            return sizeBoxes();
        }
        var id = CONTROLS[page][field];
        var element = id ? document.getElementById(id) : null;
        return element ? [element] : [];
    }

    function precedes(a, b) {
        return Boolean(a.compareDocumentPosition(b) & 4); // Node.DOCUMENT_POSITION_FOLLOWING
    }

    function init() {
        var page = pageKey();
        var estimate = globalThis.BridgePathEstimate;
        if (!page || !estimate) {
            return;
        }

        var stepTwo = document.getElementById('step2-content');
        var nextButton = document.getElementById('nextBtn2');
        var submitButton = document.getElementById('submitBtn');
        var host = document.getElementById('customerStep');
        var customerStep = host && globalThis.BridgePathCustomerStep
            ? globalThis.BridgePathCustomerStep.mount(host, {})
            : null;

        // ---- errors of step 2
        var summary = document.createElement('div');
        summary.id = 'productErrorSummary';
        summary.className = 'customer-error-summary';
        summary.setAttribute('role', 'alert');
        summary.setAttribute('tabindex', '-1');
        summary.hidden = true;
        var formSection = stepTwo ? stepTwo.querySelector('.form-section') : null;
        if (formSection) {
            formSection.insertBefore(summary, formSection.firstChild);
        }

        var shown = []; // { elements, box }

        function clearProductErrors() {
            shown.forEach(function (entry) {
                entry.elements.forEach(function (element) {
                    element.removeAttribute('aria-invalid');
                    element.removeAttribute('aria-describedby');
                });
                if (entry.box.parentNode) {
                    entry.box.parentNode.removeChild(entry.box);
                }
            });
            shown = [];
            summary.textContent = '';
            summary.hidden = true;
        }

        function showProductErrors(errors) {
            clearProductErrors();
            var seen = {};
            var first = null;
            errors.forEach(function (error) {
                if (seen[error.field]) {
                    return;
                }
                seen[error.field] = true;
                var elements = controlsFor(page, error.field);
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
            summary.textContent = '확인이 필요한 항목이 ' + shown.length + '개 있어요.';
            summary.hidden = shown.length === 0;
            if (first) {
                first.focus();
            } else {
                summary.hidden = false;
                summary.focus();
            }
        }

        if (stepTwo) {
            // A wrong value is cleared as soon as it is changed.
            var clearOn = function (event) {
                var target = event.target;
                shown = shown.filter(function (entry) {
                    if (entry.elements.indexOf(target) === -1) {
                        return true;
                    }
                    entry.elements.forEach(function (element) {
                        element.removeAttribute('aria-invalid');
                        element.removeAttribute('aria-describedby');
                    });
                    if (entry.box.parentNode) {
                        entry.box.parentNode.removeChild(entry.box);
                    }
                    return false;
                });
                if (shown.length === 0) {
                    summary.textContent = '';
                    summary.hidden = true;
                } else {
                    summary.textContent = '확인이 필요한 항목이 ' + shown.length + '개 있어요.';
                }
            };
            stepTwo.addEventListener('input', clearOn);
            stepTwo.addEventListener('change', clearOn);
        }

        // ---- step 2 -> step 3
        if (nextButton) {
            nextButton.addEventListener('click', function () {
                var result = estimate.validateSpecInput(page, selectedSubtype(), collectValues(page));
                if (!result.valid) {
                    if (result.errors.some(function (error) { return error.field === 'category'; }) && typeof globalThis.goToStep === 'function') {
                        globalThis.goToStep(1);
                        return;
                    }
                    showProductErrors(result.errors);
                    return;
                }
                clearProductErrors();
                // A page with a result screen (the sunglasses quote) shows it before the customer step.
                if (globalThis.BridgePathResult && typeof globalThis.BridgePathResult.show === 'function') {
                    globalThis.BridgePathResult.show();
                    return;
                }
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

        // ---- step 3: send the request (JSON only; files come in a later change)
        if (submitButton && customerStep) {
            initSubmit(page, estimate, customerStep, submitButton, showProductErrors);
        }
    }

    var CUSTOMER_FIELDS = ['customer_type', 'customer_name', 'company_name', 'customer_email', 'customer_phone', 'contact', 'privacy_consent'];

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

    function initSubmit(page, estimate, customerStep, submitButton, showProductErrors) {
        var config = globalThis.BridgePathConfig || {};
        var stepThree = document.getElementById('step3-content');
        var buttons = stepThree.querySelector('.form-buttons');
        var label = submitButton.textContent;
        var submitting = false; // also stays true after a success: one request per page
        var locked = [];

        var errorBox = document.createElement('div');
        errorBox.id = 'submitError';
        errorBox.className = 'customer-error-summary';
        errorBox.setAttribute('role', 'alert');
        errorBox.setAttribute('tabindex', '-1');
        errorBox.hidden = true;
        buttons.parentNode.insertBefore(errorBox, buttons);

        function showError(text) {
            errorBox.textContent = text;
            errorBox.hidden = false;
            errorBox.focus();
        }

        function setBusy(busy) {
            if (busy) {
                locked = Array.prototype.slice.call(stepThree.querySelectorAll('#customerStep input, .btn-secondary'));
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
        function showSuccess(result) {
            var box = document.getElementById('successMessage');
            document.getElementById('receiptId').textContent = result.receiptId;
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
            customerStep.reset();
            document.getElementById('customerStep').style.display = 'none';
            buttons.style.display = 'none';
            box.style.display = 'block';
            box.focus();
        }

        function showFailure(result) {
            if (result.kind === 'validation') {
                var mine = result.fieldErrors.filter(function (error) { return CUSTOMER_FIELDS.indexOf(error.field) !== -1; });
                if (mine.length > 0) {
                    customerStep.showServerErrors(mine);
                    return;
                }
            }
            showError(estimate.messageForResult(result));
        }

        async function submit() {
            if (submitting) {
                return;
            }
            var customer = customerStep.validate({ focus: true });
            if (!customer.valid) {
                return;
            }
            var subtype = selectedSubtype();
            var built = estimate.buildSpecification(page, subtype, collectValues(page));
            if (!built.ok) {
                if (typeof globalThis.goToStep === 'function') {
                    globalThis.goToStep(2);
                }
                showProductErrors(built.errors);
                return;
            }

            submitting = true;
            errorBox.hidden = true;
            setBusy(true);
            var result;
            try {
                var request = estimate.buildRequest({
                    apiBase: config.API_BASE,
                    page: page,
                    subtype: subtype,
                    spec: built.spec,
                    customer: customer.value,
                    consentVersion: config.PRIVACY_CONSENT_VERSION,
                    files: []
                });
                result = await estimate.submitEstimate({
                    request: request,
                    fetch: function (url, init) { return globalThis.fetch(url, init); },
                    timeoutMs: config.REQUEST_TIMEOUT_MS,
                    hadFiles: false
                });
            } catch (error) {
                result = { kind: 'unexpected' };
            }

            if (result.kind === 'success') {
                submitButton.removeAttribute('aria-busy');
                showSuccess(result);
                return; // `submitting` stays true: one request per page
            }
            // The form is given back first, so that the focus can go to a field.
            setBusy(false);
            submitting = false;
            showFailure(result);
        }

        submitButton.addEventListener('click', submit);
    }

    globalThis.BridgePathFlow = { init: init, collectValues: collectValues, CONTROLS: CONTROLS };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = globalThis.BridgePathFlow;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
