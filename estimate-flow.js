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
            bridgeWidth: 'bridgeWidth', armLength: 'armLength', lensWidth: 'lensWidth', quantity: 'quantity',
            deliveryDate: 'deliveryDate', additionalInfo: 'additionalInfo'
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

        // ---- the customer information has to be right before the page script goes on. This listener
        // is registered before the one of the page script and stops it while the input is wrong.
        if (submitButton && customerStep) {
            submitButton.addEventListener('click', function (event) {
                var result = customerStep.validate({ focus: true });
                if (!result.valid) {
                    event.stopImmediatePropagation();
                }
            });
        }
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
