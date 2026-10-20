// The inquiry of the other products (a single page, no steps): the product input and the customer
// information are checked together and sent as JSON with the category "other". The checks, the
// request and the result are those of estimate-api.js and estimate-submit.js; this file only knows
// the controls of the page. The attachments are the shared component (estimate-attachments.js).
(function () {
    'use strict';

    // The id of the control of each value of the product input.
    var CONTROLS = {
        productDescription: 'productDescription',
        quantity: 'quantity',
        deliveryDate: 'deliveryDate',
        additionalInfo: 'additionalInfo'
    };

    function collectValues() {
        var values = {};
        Object.keys(CONTROLS).forEach(function (key) {
            var element = document.getElementById(CONTROLS[key]);
            values[key] = element ? element.value : '';
        });
        return values;
    }

    // What the receipt says about the product.
    function summaryRows() {
        var values = collectValues();
        var rows = [];
        [
            ['productDescription', '제품 설명'],
            ['quantity', '수량'],
            ['deliveryDate', '희망 납기일'],
            ['additionalInfo', '추가 요청사항']
        ].forEach(function (entry) {
            var value = typeof values[entry[0]] === 'string' ? values[entry[0]].trim() : '';
            if (value === '') {
                return;
            }
            if (entry[0] === 'quantity') {
                value = Number(value).toLocaleString('ko-KR') + '개';
            }
            rows.push({ label: entry[1], value: value.length > 100 ? value.slice(0, 100) + '…' : value });
        });
        return rows;
    }

    function controlsFor(field) {
        var id = CONTROLS[field];
        var element = id ? document.getElementById(id) : null;
        return element ? [element] : [];
    }

    function init() {
        var form = document.getElementById('inquiryForm');
        var submitButton = document.getElementById('submitBtn');
        var host = document.getElementById('customerStep');
        if (!form || !submitButton || !host || !globalThis.BridgePathEstimate || !globalThis.BridgePathCustomerStep || !globalThis.BridgePathSubmit) {
            return;
        }

        var customerStep = globalThis.BridgePathCustomerStep.mount(host, {});
        var attachmentsHost = document.getElementById('attachments');
        var attachments = attachmentsHost && globalThis.BridgePathAttachments
            ? globalThis.BridgePathAttachments.mount(attachmentsHost, {})
            : null;
        var productErrors = globalThis.BridgePathSubmit.createProductErrors({
            controlsFor: controlsFor,
            summaryParent: form,
            summaryBefore: form.firstChild,
            listenOn: form
        });
        var submitter = globalThis.BridgePathSubmit.createSubmitter({
            page: 'other',
            getSubtype: function () { return null; },
            collectValues: collectValues,
            customerStep: customerStep,
            productErrors: productErrors,
            submitButton: submitButton,
            successBox: document.getElementById('successMessage'),
            errorParent: form,
            errorBefore: submitButton,
            lockElements: function () {
                return Array.prototype.slice.call(form.querySelectorAll('input, textarea, select, button'));
            },
            getFiles: function () { return attachments ? attachments.getFiles() : []; },
            getSummary: summaryRows,
            afterSuccess: function () {
                if (attachments) {
                    attachments.reset();
                }
            },
            hideOnSuccess: [form]
        });

        // The form is not sent by the browser: Enter in a field and the button both end up here.
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            submitter.submit();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
