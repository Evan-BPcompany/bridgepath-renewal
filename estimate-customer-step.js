// The customer information step of the estimate forms (PRD FR-4.2): type, name, company,
// contact and the consent to the privacy policy. It only builds the fields, checks them with
// BridgePathEstimate.validateCustomer and shows what is wrong. It sends nothing.
//
// Everything that comes from outside (a message, a value) is put in with textContent or
// setAttribute; there is no innerHTML in this file.
(function () {
    'use strict';

    var FIELD_ORDER = ['customer_type', 'customer_name', 'company_name', 'customer_email', 'customer_phone', 'contact', 'privacy_consent'];

    var COMPANY_LABEL_OPTIONAL = '회사명·브랜드명 (선택)';
    var COMPANY_LABEL_REQUIRED = '회사명 또는 브랜드명 *';

    function create(doc, tag, attributes, text) {
        var node = doc.createElement(tag);
        Object.keys(attributes || {}).forEach(function (name) {
            node.setAttribute(name, attributes[name]);
        });
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function api() {
        var estimate = globalThis.BridgePathEstimate;
        if (!estimate) {
            throw new Error('estimate-api.js has to be loaded before estimate-customer-step.js');
        }
        return estimate;
    }

    // container: an element that stays empty until now. options.inline leaves out the summary of
    // the errors for a page that has its own (used by the single-step form).
    function mount(container, options) {
        var settings = options || {};
        var estimate = api();
        var doc = container.ownerDocument;
        var config = globalThis.BridgePathConfig || {};
        var consentUrl = settings.consentUrl || config.PRIVACY_CONSENT_URL || 'privacy-consent.html';

        container.textContent = '';
        var root = create(doc, 'div', { class: 'customer-step' + (settings.inline ? ' customer-step--inline' : '') });

        var summary = null;
        if (!settings.inline) {
            summary = create(doc, 'div', { id: 'customerErrorSummary', class: 'customer-error-summary', role: 'alert', tabindex: '-1' });
            summary.hidden = true;
            root.appendChild(summary);
        }

        var errorBoxes = {}; // field -> <p>
        var controls = {}; // field -> [elements that get aria-invalid]
        var baseDescribedBy = new Map(); // element -> ids that stay (hints)

        function errorBox(field, id) {
            var box = create(doc, 'p', { id: id, class: 'field-error' });
            box.hidden = true;
            errorBoxes[field] = box;
            return box;
        }

        function register(field, elements, extraDescribedBy) {
            controls[field] = elements;
            elements.forEach(function (element) {
                baseDescribedBy.set(element, extraDescribedBy || []);
            });
        }

        // ---- customer type
        var typeSet = create(doc, 'fieldset', { class: 'customer-fieldset', id: 'customerTypeGroup' });
        typeSet.appendChild(create(doc, 'legend', {}, '고객 유형 *'));
        typeSet.appendChild(create(doc, 'p', { id: 'customerTypeHint', class: 'customer-hint' }, estimate.CUSTOMER_TYPE_HINT));
        var typeInputs = [];
        [['individual_startup', 'customerTypeIndividual'], ['business_brand', 'customerTypeBusiness']].forEach(function (pair) {
            var row = create(doc, 'div', { class: 'customer-choice' });
            var input = create(doc, 'input', { type: 'radio', name: 'customer_type', value: pair[0], id: pair[1] });
            var label = create(doc, 'label', { for: pair[1] }, estimate.CUSTOMER_TYPES[pair[0]]);
            row.appendChild(input);
            row.appendChild(label);
            typeSet.appendChild(row);
            typeInputs.push(input);
        });
        typeSet.appendChild(errorBox('customer_type', 'customerTypeError'));
        register('customer_type', typeInputs, ['customerTypeHint']);
        root.appendChild(typeSet);

        // ---- name
        var nameGroup = create(doc, 'div', { class: 'form-group' });
        nameGroup.appendChild(create(doc, 'label', { for: 'customerName' }, '담당자 이름 *'));
        var nameInput = create(doc, 'input', {
            type: 'text', id: 'customerName', name: 'customer_name', autocomplete: 'name',
            maxlength: String(estimate.LIMITS.name), 'aria-required': 'true'
        });
        nameGroup.appendChild(nameInput);
        nameGroup.appendChild(errorBox('customer_name', 'customerNameError'));
        register('customer_name', [nameInput]);
        root.appendChild(nameGroup);

        // ---- company: always there; only the label and the requirement depend on the type
        var companyGroup = create(doc, 'div', { class: 'form-group' });
        var companyLabel = create(doc, 'label', { for: 'customerCompany', id: 'customerCompanyLabel' }, COMPANY_LABEL_OPTIONAL);
        companyGroup.appendChild(companyLabel);
        var companyInput = create(doc, 'input', {
            type: 'text', id: 'customerCompany', name: 'company_name', autocomplete: 'organization',
            maxlength: String(estimate.LIMITS.company), 'aria-required': 'false'
        });
        companyGroup.appendChild(companyInput);
        companyGroup.appendChild(errorBox('company_name', 'customerCompanyError'));
        register('company_name', [companyInput]);
        root.appendChild(companyGroup);

        // ---- contact: one of the two
        var contactSet = create(doc, 'fieldset', { class: 'customer-fieldset', id: 'customerContactGroup' });
        contactSet.appendChild(create(doc, 'legend', {}, '연락처 (이메일 또는 전화번호 중 하나는 꼭 입력) *'));
        var contactRow = create(doc, 'div', { class: 'form-row' });
        var emailGroup = create(doc, 'div', { class: 'form-group' });
        emailGroup.appendChild(create(doc, 'label', { for: 'customerEmail' }, '이메일'));
        var emailInput = create(doc, 'input', {
            type: 'email', id: 'customerEmail', name: 'customer_email', autocomplete: 'email',
            maxlength: String(estimate.LIMITS.email), placeholder: 'name@example.com'
        });
        emailGroup.appendChild(emailInput);
        emailGroup.appendChild(errorBox('customer_email', 'customerEmailError'));
        var phoneGroup = create(doc, 'div', { class: 'form-group' });
        phoneGroup.appendChild(create(doc, 'label', { for: 'customerPhone' }, '전화번호'));
        var phoneInput = create(doc, 'input', {
            type: 'tel', id: 'customerPhone', name: 'customer_phone', autocomplete: 'tel',
            maxlength: String(estimate.LIMITS.phone), placeholder: '010-1234-5678'
        });
        phoneGroup.appendChild(phoneInput);
        phoneGroup.appendChild(errorBox('customer_phone', 'customerPhoneError'));
        contactRow.appendChild(emailGroup);
        contactRow.appendChild(phoneGroup);
        contactSet.appendChild(contactRow);
        contactSet.appendChild(errorBox('contact', 'customerContactError'));
        register('customer_email', [emailInput]);
        register('customer_phone', [phoneInput]);
        // The group error belongs to both inputs.
        controls.contact = [emailInput, phoneInput];
        root.appendChild(contactSet);

        // ---- consent
        var consentGroup = create(doc, 'div', { class: 'customer-consent' });
        var consentRow = create(doc, 'div', { class: 'customer-choice' });
        var consentInput = create(doc, 'input', { type: 'checkbox', id: 'privacyConsent', name: 'privacy_consent', 'aria-required': 'true' });
        var consentLabel = create(doc, 'label', { for: 'privacyConsent' }, '개인정보 수집·이용에 동의합니다 (필수)');
        var consentLink = create(doc, 'a', { href: consentUrl, target: '_blank', rel: 'noopener noreferrer', class: 'customer-consent-link' }, '내용 보기');
        consentRow.appendChild(consentInput);
        consentRow.appendChild(consentLabel);
        consentRow.appendChild(consentLink);
        consentGroup.appendChild(consentRow);
        consentGroup.appendChild(errorBox('privacy_consent', 'privacyConsentError'));
        register('privacy_consent', [consentInput]);
        root.appendChild(consentGroup);

        container.appendChild(root);

        // ---- state helpers
        function currentType() {
            var picked = typeInputs.filter(function (input) { return input.checked; })[0];
            return picked ? picked.value : '';
        }

        // aria-invalid and aria-describedby of a control follow the errors that are shown for it
        // (its own and, for the two contact inputs, the one of the group).
        function refreshControl(element) {
            var ids = (baseDescribedBy.get(element) || []).slice();
            var invalid = false;
            FIELD_ORDER.forEach(function (field) {
                if (errorBoxes[field] && !errorBoxes[field].hidden && (controls[field] || []).indexOf(element) !== -1) {
                    invalid = true;
                    ids.push(errorBoxes[field].id);
                }
            });
            if (invalid) {
                element.setAttribute('aria-invalid', 'true');
            } else {
                element.removeAttribute('aria-invalid');
            }
            if (ids.length > 0) {
                element.setAttribute('aria-describedby', ids.join(' '));
            } else {
                element.removeAttribute('aria-describedby');
            }
        }

        function setError(field, message) {
            var box = errorBoxes[field];
            box.textContent = message;
            box.hidden = false;
            (controls[field] || []).forEach(refreshControl);
        }

        function clearError(field) {
            var box = errorBoxes[field];
            if (!box || box.hidden) {
                return;
            }
            box.textContent = '';
            box.hidden = true;
            (controls[field] || []).forEach(refreshControl);
            refreshSummary();
        }

        function visibleFields() {
            return FIELD_ORDER.filter(function (field) {
                return errorBoxes[field] && !errorBoxes[field].hidden;
            });
        }

        function refreshSummary() {
            if (!summary) {
                return;
            }
            var count = visibleFields().length;
            if (count === 0) {
                summary.textContent = '';
                summary.hidden = true;
            } else {
                summary.textContent = '확인이 필요한 항목이 ' + count + '개 있어요.';
                summary.hidden = false;
            }
        }

        function clearAll() {
            FIELD_ORDER.forEach(clearError);
            refreshSummary();
        }

        function focusFirstInvalid() {
            var first = visibleFields()[0];
            var target = first && controls[first] && controls[first][0];
            if (target) {
                target.focus();
            } else if (summary) {
                summary.focus();
            }
        }

        function showErrors(errors, focus) {
            clearAll();
            var seen = {};
            (errors || []).forEach(function (error) {
                if (!errorBoxes[error.field] || seen[error.field]) {
                    return;
                }
                seen[error.field] = true;
                setError(error.field, estimate.messageFor(error.code, { max: error.max }));
            });
            refreshSummary();
            if (focus) {
                focusFirstInvalid();
            }
        }

        function getInput() {
            return {
                customer_type: currentType(),
                customer_name: nameInput.value,
                company_name: companyInput.value,
                customer_email: emailInput.value,
                customer_phone: phoneInput.value,
                privacy_consent: consentInput.checked === true
            };
        }

        function applyType() {
            var business = currentType() === 'business_brand';
            companyLabel.textContent = business ? COMPANY_LABEL_REQUIRED : COMPANY_LABEL_OPTIONAL;
            companyInput.setAttribute('aria-required', business ? 'true' : 'false');
        }

        typeInputs.forEach(function (input) {
            input.addEventListener('change', function () {
                applyType();
                clearError('customer_type');
                clearError('company_name');
            });
        });
        [['customer_name', nameInput], ['company_name', companyInput], ['customer_email', emailInput], ['customer_phone', phoneInput]].forEach(function (pair) {
            pair[1].addEventListener('input', function () {
                clearError(pair[0]);
                if (pair[0] === 'customer_email' || pair[0] === 'customer_phone') {
                    clearError('contact');
                }
            });
        });
        consentInput.addEventListener('change', function () { clearError('privacy_consent'); });

        return {
            getInput: getInput,
            // Checks the fields; with focus the first wrong control gets the focus.
            validate: function (validateOptions) {
                var result = estimate.validateCustomer(getInput());
                showErrors(result.errors, Boolean(validateOptions && validateOptions.focus));
                return result;
            },
            // errors: [{ field, code, max? }] with the names of the API (customer_name, ...).
            showServerErrors: function (errors) {
                showErrors(errors, true);
            },
            reset: function () {
                typeInputs.forEach(function (input) { input.checked = false; });
                [nameInput, companyInput, emailInput, phoneInput].forEach(function (input) { input.value = ''; });
                consentInput.checked = false;
                applyType();
                clearAll();
            }
        };
    }

    var exported = { mount: mount, COMPANY_LABEL_OPTIONAL: COMPANY_LABEL_OPTIONAL, COMPANY_LABEL_REQUIRED: COMPANY_LABEL_REQUIRED };
    globalThis.BridgePathCustomerStep = exported;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
})();
