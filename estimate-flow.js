// The three steps of the estimate pages (sunglasses, shoes, golf): the product input of step 2 is
// checked before step 3, and step 3 (customer information) is mounted and checked before the
// page script goes on. The request itself is sent by estimate-submit.js.
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

        // The attachments of step 2 (reference photos, design files).
        var attachmentsHost = document.getElementById('attachments');
        var attachments = attachmentsHost && globalThis.BridgePathAttachments
            ? globalThis.BridgePathAttachments.mount(attachmentsHost, {})
            : null;

        // ---- errors of step 2
        var formSection = stepTwo ? stepTwo.querySelector('.form-section') : null;
        var productErrors = null;
        if (formSection && globalThis.BridgePathSubmit) {
            productErrors = globalThis.BridgePathSubmit.createProductErrors({
                controlsFor: function (field) { return controlsFor(page, field); },
                summaryParent: formSection,
                summaryBefore: formSection.firstChild,
                listenOn: stepTwo
            });
        }

        // ---- step 2 -> step 3
        if (nextButton && productErrors) {
            nextButton.addEventListener('click', function () {
                var result = estimate.validateSpecInput(page, selectedSubtype(), collectValues(page));
                if (!result.valid) {
                    if (result.errors.some(function (error) { return error.field === 'category'; }) && typeof globalThis.goToStep === 'function') {
                        globalThis.goToStep(1);
                        return;
                    }
                    productErrors.show(result.errors);
                    return;
                }
                productErrors.clear();
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
        if (submitButton && customerStep && productErrors && globalThis.BridgePathSubmit) {
            var stepThree = document.getElementById('step3-content');
            var buttons = stepThree.querySelector('.form-buttons');
            var submitter = globalThis.BridgePathSubmit.createSubmitter({
                page: page,
                getSubtype: selectedSubtype,
                collectValues: function () { return collectValues(page); },
                customerStep: customerStep,
                productErrors: productErrors,
                submitButton: submitButton,
                successBox: document.getElementById('successMessage'),
                errorParent: buttons.parentNode,
                errorBefore: buttons,
                lockElements: function () {
                    return Array.prototype.slice.call(stepThree.querySelectorAll('#customerStep input, .btn-secondary'));
                },
                hideOnSuccess: [document.getElementById('customerStep'), buttons],
                getFiles: function () { return attachments ? attachments.getFiles() : []; },
                // The sunglasses page records what its screen showed (estimate-result.js).
                getExtraSpec: function () {
                    var result = globalThis.BridgePathResult;
                    return result && typeof result.getAiPreview === 'function' ? { ai_preview: result.getAiPreview() } : null;
                },
                afterSuccess: function () {
                    if (attachments) {
                        attachments.reset();
                    }
                },
                onProductInvalid: function () {
                    if (typeof globalThis.goToStep === 'function') {
                        globalThis.goToStep(2);
                    }
                }
            });
            submitButton.addEventListener('click', submitter.submit);
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
