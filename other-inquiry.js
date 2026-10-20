// The inquiry of the other products (a single page, no steps): the product input and the customer
// information are checked together and sent as JSON with the category "other". The checks, the
// request and the result are those of estimate-api.js and estimate-submit.js; this file only knows
// the controls of the page. Files are not sent yet, so the upload box is disabled in the HTML.
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
