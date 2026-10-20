// Logic of the estimate forms that does not touch the page: which category to send, the
// specification_json, the checks of the customer details and of the attached files, the request
// for POST /api/estimates and the reading of its answer.
//
// Nothing here reads or writes the DOM, and nothing here builds HTML. Every text this file returns
// (messageFor) is plain text: put it on the page with textContent, never with innerHTML, above all
// when it contains something the visitor typed (a file name).
//
// Load config.js first when the page needs BridgePathConfig. In Node (the tests) the module is
// required instead.
(function () {
    'use strict';

    // ------------------------------------------------------------------------------------------
    // Categories. The API stores one of four categories; the kind of product inside it
    // (optical, sneakers, bags, ...) goes into the specification. Sending the kind as the category
    // is not possible: the database refuses it.

    var PAGES = Object.freeze({
        sunglasses: Object.freeze({
            category: 'eyewear',
            typeField: 'frame_type',
            subtypes: Object.freeze(['optical', 'sunglasses', 'sports', 'kids', 'safety'])
        }),
        shoes: Object.freeze({
            category: 'shoes',
            typeField: 'shoe_type',
            // 'other' is the last card of the shoes page ("기타"): another kind of shoe, still the category shoes.
            subtypes: Object.freeze(['sneakers', 'heels', 'mens', 'boots', 'sandals', 'other'])
        }),
        golf: Object.freeze({
            category: 'golf_products',
            typeField: 'product_type',
            subtypes: Object.freeze(['bags', 'gloves', 'headwear', 'accessories', 'covers', 'training'])
        }),
        other: Object.freeze({
            category: 'other',
            typeField: null,
            subtypes: Object.freeze([])
        })
    });

    var SCHEMA_VERSION = '1.0';
    var UNKNOWN = 'unknown'; // "잘 모르겠음"

    var UNKNOWN_LABEL = '잘 모르겠음';

    // Values of the select boxes (the API wants a value for these; "unknown" is one of them).
    var OPTIONS = Object.freeze({
        lensType: Object.freeze(['normal', 'polarized', 'mirror', 'gradient', 'photochromic', UNKNOWN]),
        frameMaterial: Object.freeze(['metal', 'plastic', 'acetate', 'mixed', 'wood', UNKNOWN]),
        shoesMaterial: Object.freeze(['leather', 'canvas', 'mesh', 'synthetic', 'rubber', 'mixed', UNKNOWN]),
        golfMaterial: Object.freeze([
            'polyester', 'nylon', 'leather', 'synthetic', 'rubber', 'metal', 'cotton', 'wool', 'mixed', UNKNOWN
        ]),
        shoeSizes: Object.freeze([220, 230, 240, 250, 260, 270, 280, 290])
    });

    var CUSTOMER_TYPES = Object.freeze({
        individual_startup: '개인·창업 준비 중',
        business_brand: '사업자·브랜드 운영 중'
    });

    // Shown with the choice of the customer type (PRD FR-4.2): the first option is not for consumers.
    var CUSTOMER_TYPE_HINT =
        '창업을 준비 중이거나 제품 제작·소싱을 문의하시는 분용이에요. 완제품을 구매하려는 일반 소비자용이 아니에요.';

    var LIMITS = Object.freeze({
        name: 100,
        company: 100,
        email: 100,
        phone: 20,
        phoneMinDigits: 7,
        phoneMaxDigits: 15,
        quantityMax: 1000000,
        textShort: 100,
        textLong: 2000,
    });

    var MB = 1024 * 1024;

    // PRD FR-2.6. WEBP and GIF are not accepted for now (the API does not take WEBP either).
    var FILE_POLICY = Object.freeze({
        maxFiles: 5,
        maxFileBytes: 10 * MB,
        maxTotalBytes: 30 * MB,
        types: Object.freeze({
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            pdf: 'application/pdf'
        })
    });

    function hasOwn(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function isBlank(value) {
        return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    }

    function normalizeCategory(page, subtype) {
        if (typeof page !== 'string' || !hasOwn(PAGES, page)) {
            return null;
        }
        var entry = PAGES[page];

        if (entry.typeField === null) {
            return isBlank(subtype) ? { category: entry.category, subtype: null } : null;
        }
        if (typeof subtype !== 'string' || entry.subtypes.indexOf(subtype) === -1) {
            return null;
        }
        return { category: entry.category, subtype: subtype };
    }

    // ------------------------------------------------------------------------------------------
    // The specification

    var QUANTITY_PATTERN = /^[0-9]{1,7}$/;
    var DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

    function text(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function validDate(value) {
        if (!DATE_PATTERN.test(value)) {
            return false;
        }
        var parts = value.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
    }

    function checkQuantity(values, errors) {
        var raw = typeof values.quantity === 'number' ? String(values.quantity) : text(values.quantity);
        if (!QUANTITY_PATTERN.test(raw)) {
            errors.push({ field: 'quantity', code: 'quantity_invalid' });
            return undefined;
        }
        var quantity = Number(raw);
        if (quantity < 1 || quantity > LIMITS.quantityMax) {
            errors.push({ field: 'quantity', code: 'quantity_invalid' });
            return undefined;
        }
        return quantity;
    }

    function checkChoice(values, field, allowed, errors) {
        var value = text(values[field]);
        if (value === '') {
            errors.push({ field: field, code: 'choice_required' });
            return undefined;
        }
        if (allowed.indexOf(value) === -1) {
            errors.push({ field: field, code: 'invalid_choice' });
            return undefined;
        }
        return value;
    }

    function checkOptionalText(values, field, max, errors) {
        var value = text(values[field]);
        if (value === '') {
            return undefined;
        }
        if (value.length > max) {
            errors.push({ field: field, code: 'too_long', max: max });
            return undefined;
        }
        return value;
    }

    function checkOptionalDate(values, errors) {
        var value = text(values.deliveryDate);
        if (value === '') {
            return undefined;
        }
        if (!validDate(value)) {
            errors.push({ field: 'deliveryDate', code: 'invalid_date' });
            return undefined;
        }
        return value;
    }

    function checkSizes(values, errors) {
        var picked = Array.isArray(values.sizes) ? values.sizes : [];
        var sizes = [];
        for (var i = 0; i < picked.length; i += 1) {
            var size = Number(picked[i]);
            if (OPTIONS.shoeSizes.indexOf(size) === -1) {
                errors.push({ field: 'sizes', code: 'invalid_choice' });
                return undefined;
            }
            if (sizes.indexOf(size) === -1) {
                sizes.push(size);
            }
        }
        if (sizes.length === 0) {
            errors.push({ field: 'sizes', code: 'sizes_required' });
            return undefined;
        }
        return sizes.sort(function (a, b) { return a - b; });
    }

    // Checks the part of the form that belongs to the product. The result lists what is wrong by
    // field; the values themselves are not repeated.
    function analyseSpec(page, subtype, values) {
        var errors = [];
        var spec = { schema_version: SCHEMA_VERSION };
        var kind = normalizeCategory(page, subtype);
        var input = values && typeof values === 'object' ? values : {};

        if (!kind) {
            return { ok: false, errors: [{ field: 'category', code: 'invalid_choice' }] };
        }

        spec.quantity = checkQuantity(input, errors);

        function put(key, value) {
            if (value !== undefined) {
                spec[key] = value;
            }
        }

        if (page === 'sunglasses') {
            spec.frame_type = kind.subtype;
            spec.material = checkChoice(input, 'frameMaterial', OPTIONS.frameMaterial, errors);
            spec.lens_type = checkChoice(input, 'lensType', OPTIONS.lensType, errors);
            put('frame_color', checkOptionalText(input, 'frameColor', LIMITS.textShort, errors));
            put('lens_color', checkOptionalText(input, 'lensColor', LIMITS.textShort, errors));
            put('additional_info', checkOptionalText(input, 'additionalInfo', LIMITS.textLong, errors));
        } else if (page === 'shoes') {
            spec.shoe_type = kind.subtype;
            spec.material = checkChoice(input, 'material', OPTIONS.shoesMaterial, errors);
            var sizes = checkSizes(input, errors);
            if (sizes) {
                spec.sizes = sizes;
                spec.size_range = sizes[0] === sizes[sizes.length - 1] ? String(sizes[0]) : sizes[0] + '-' + sizes[sizes.length - 1];
            }
            put('color', checkOptionalText(input, 'color', LIMITS.textShort, errors));
            put('special_requirements', checkOptionalText(input, 'additionalInfo', LIMITS.textLong, errors));
        } else if (page === 'golf') {
            spec.product_type = kind.subtype;
            spec.material = checkChoice(input, 'material', OPTIONS.golfMaterial, errors);
            put('color', checkOptionalText(input, 'color', LIMITS.textShort, errors));
            put('size', checkOptionalText(input, 'size', LIMITS.textShort, errors));
            put('customization', checkOptionalText(input, 'design', LIMITS.textShort, errors));
            put('additional_info', checkOptionalText(input, 'additionalInfo', LIMITS.textLong, errors));
        } else {
            var description = text(input.productDescription);
            if (description === '') {
                errors.push({ field: 'productDescription', code: 'description_required' });
            } else if (description.length > LIMITS.textLong) {
                errors.push({ field: 'productDescription', code: 'too_long', max: LIMITS.textLong });
            } else {
                spec.product_description = description;
            }
            put('special_requirements', checkOptionalText(input, 'additionalInfo', LIMITS.textLong, errors));
        }

        put('delivery_date', checkOptionalDate(input, errors));

        if (errors.length > 0) {
            return { ok: false, errors: errors };
        }
        // Without undefined members, so that the object is exactly what is sent.
        return { ok: true, spec: JSON.parse(JSON.stringify(spec)), category: kind.category };
    }

    function validateSpecInput(page, subtype, values) {
        var result = analyseSpec(page, subtype, values);
        return { valid: result.ok, errors: result.ok ? [] : result.errors };
    }

    function buildSpecification(page, subtype, values) {
        var result = analyseSpec(page, subtype, values);
        return result.ok ? { ok: true, spec: result.spec } : { ok: false, errors: result.errors };
    }

    // ------------------------------------------------------------------------------------------
    // The customer. The same rules as the API (src/utils/customerValidation.ts).

    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var PHONE_CHARS = /^[0-9+\-()\s]+$/;
    // eslint-disable-next-line no-control-regex
    var CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

    function cleanText(raw, field, errors) {
        if (raw === undefined || raw === null) {
            return undefined;
        }
        if (typeof raw !== 'string') {
            errors.push({ field: field, code: 'invalid_chars' });
            return undefined;
        }
        var trimmed = raw.trim();
        if (trimmed === '') {
            return undefined;
        }
        if (CONTROL_CHARS.test(trimmed)) {
            errors.push({ field: field, code: 'invalid_chars' });
            return undefined;
        }
        return trimmed;
    }

    function validPhone(phone) {
        if (!PHONE_CHARS.test(phone) || phone.lastIndexOf('+') > 0) {
            return false;
        }
        var digits = phone.replace(/\D/g, '').length;
        return digits >= LIMITS.phoneMinDigits && digits <= LIMITS.phoneMaxDigits;
    }

    function validateCustomer(input) {
        var data = input && typeof input === 'object' ? input : {};
        var errors = [];

        var type = typeof data.customer_type === 'string' ? data.customer_type.trim() : '';
        if (type === '') {
            errors.push({ field: 'customer_type', code: 'customer_type_required' });
        } else if (!hasOwn(CUSTOMER_TYPES, type)) {
            errors.push({ field: 'customer_type', code: 'invalid_choice' });
            type = '';
        }

        var name = cleanText(data.customer_name, 'customer_name', errors);
        var nameFailed = errors.some(function (e) { return e.field === 'customer_name'; });
        if (name === undefined && !nameFailed) {
            errors.push({ field: 'customer_name', code: 'name_required' });
        } else if (name !== undefined && name.length > LIMITS.name) {
            errors.push({ field: 'customer_name', code: 'too_long', max: LIMITS.name });
        }

        var company = cleanText(data.company_name, 'company_name', errors);
        var companyFailed = errors.some(function (e) { return e.field === 'company_name'; });
        if (company !== undefined && company.length > LIMITS.company) {
            errors.push({ field: 'company_name', code: 'too_long', max: LIMITS.company });
        } else if (type === 'business_brand' && company === undefined && !companyFailed) {
            errors.push({ field: 'company_name', code: 'company_required' });
        }

        var email = cleanText(data.customer_email, 'customer_email', errors);
        if (email !== undefined) {
            if (email.length > LIMITS.email) {
                errors.push({ field: 'customer_email', code: 'too_long', max: LIMITS.email });
            } else if (!EMAIL_PATTERN.test(email)) {
                errors.push({ field: 'customer_email', code: 'invalid_email' });
            }
        }

        var phone = cleanText(data.customer_phone, 'customer_phone', errors);
        if (phone !== undefined) {
            if (phone.length > LIMITS.phone) {
                errors.push({ field: 'customer_phone', code: 'too_long', max: LIMITS.phone });
            } else if (!validPhone(phone)) {
                errors.push({ field: 'customer_phone', code: 'invalid_phone' });
            }
        }

        var contactRejected = errors.some(function (e) {
            return e.field === 'customer_email' || e.field === 'customer_phone';
        });
        if (email === undefined && phone === undefined && !contactRejected) {
            errors.push({ field: 'contact', code: 'contact_required' });
        }

        if (data.privacy_consent !== true) {
            errors.push({ field: 'privacy_consent', code: 'consent_required' });
        }

        if (errors.length > 0) {
            return { valid: false, errors: errors };
        }

        var value = { customer_type: type, customer_name: name };
        if (company !== undefined) {
            value.company_name = company;
        }
        if (email !== undefined) {
            value.customer_email = email;
        }
        if (phone !== undefined) {
            value.customer_phone = phone;
        }
        return { valid: true, errors: [], value: value };
    }

    // ------------------------------------------------------------------------------------------
    // Attached files. `selected` are the files already accepted; `incoming` the ones just chosen.
    // A file is { name, size, type } (a File works).

    function extensionOf(name) {
        var fileName = typeof name === 'string' ? name : '';
        var dot = fileName.lastIndexOf('.');
        return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
    }

    function checkFileType(file) {
        var extension = extensionOf(file.name);
        var type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
        var expected = hasOwn(FILE_POLICY.types, extension) ? FILE_POLICY.types[extension] : undefined;
        var allowedTypes = Object.keys(FILE_POLICY.types).map(function (key) { return FILE_POLICY.types[key]; });

        if (type === '') {
            return expected === undefined ? 'type_not_allowed' : 'type_unknown';
        }
        if (expected === undefined || allowedTypes.indexOf(type) === -1) {
            return 'type_not_allowed';
        }
        return expected === type ? null : 'type_mismatch';
    }

    function validateFiles(selected, incoming) {
        var current = Array.isArray(selected) ? selected : [];
        var added = Array.isArray(incoming) ? incoming : [];
        var accepted = [];
        var rejected = [];
        var duplicates = [];
        var totalBytes = current.reduce(function (sum, file) { return sum + (file.size || 0); }, 0);
        var count = current.length;
        var seen = current.map(function (file) { return file.name + '|' + file.size; });

        added.forEach(function (file) {
            var size = typeof file.size === 'number' ? file.size : 0;
            var code = checkFileType(file);

            if (code === null && size <= 0) {
                code = 'empty';
            } else if (code === null && size > FILE_POLICY.maxFileBytes) {
                code = 'too_large';
            } else if (code === null && count >= FILE_POLICY.maxFiles) {
                code = 'too_many';
            } else if (code === null && totalBytes + size > FILE_POLICY.maxTotalBytes) {
                code = 'total_too_large';
            }

            if (code !== null) {
                rejected.push({ name: file.name, code: code });
                return;
            }

            var key = file.name + '|' + size;
            if (seen.indexOf(key) !== -1) {
                duplicates.push(file.name);
            }
            seen.push(key);
            accepted.push(file);
            count += 1;
            totalBytes += size;
        });

        return { accepted: accepted, rejected: rejected, duplicates: duplicates, totalBytes: totalBytes, count: count };
    }

    // ------------------------------------------------------------------------------------------
    // The request

    function joinUrl(apiBase, path) {
        return String(apiBase || '').replace(/\/+$/, '') + path;
    }

    // Builds the request of POST /api/estimates. Without files a JSON body is sent; with files a
    // multipart form (the browser sets the Content-Type with its boundary, so none is given here).
    // The two bodies mean the same to the API; only the consent differs: true in JSON and the text
    // "true" in a form, which has no booleans.
    function buildRequest(options) {
        var kind = normalizeCategory(options.page, options.subtype);
        if (!kind) {
            throw new TypeError('Unknown page or kind of product');
        }
        if (!options.spec || typeof options.spec !== 'object') {
            throw new TypeError('The specification is missing');
        }
        var customer = options.customer || {};
        var files = Array.isArray(options.files) ? options.files : [];

        var fields = {
            category: kind.category,
            customer_type: customer.customer_type,
            customer_name: customer.customer_name,
            company_name: customer.company_name,
            customer_email: customer.customer_email,
            customer_phone: customer.customer_phone,
            privacy_consent_version: options.consentVersion
        };
        var url = joinUrl(options.apiBase, '/api/estimates');

        if (files.length === 0) {
            var payload = {};
            Object.keys(fields).forEach(function (key) {
                if (!isBlank(fields[key])) {
                    payload[key] = fields[key];
                }
            });
            payload.specification_json = options.spec;
            payload.privacy_consent = true;

            return {
                url: url,
                init: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'omit'
                }
            };
        }

        if (typeof FormData === 'undefined') {
            throw new TypeError('FormData is not available');
        }
        var form = new FormData();
        Object.keys(fields).forEach(function (key) {
            if (!isBlank(fields[key])) {
                form.append(key, fields[key]);
            }
        });
        form.append('specification_json', JSON.stringify(options.spec));
        form.append('privacy_consent', 'true');
        files.forEach(function (file) {
            form.append('files', file, file.name);
        });

        return {
            url: url,
            init: {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body: form,
                credentials: 'omit'
            }
        };
    }

    // ------------------------------------------------------------------------------------------
    // The answer

    function headerOf(headers, name) {
        if (!headers) {
            return undefined;
        }
        if (typeof headers.get === 'function') {
            var found = headers.get(name);
            return found === null ? undefined : found;
        }
        var wanted = name.toLowerCase();
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i += 1) {
            if (keys[i].toLowerCase() === wanted) {
                return headers[keys[i]];
            }
        }
        return undefined;
    }

    var DEFAULT_RETRY_SECONDS = 60;
    var MAX_RETRY_SECONDS = 3600;

    // Retry-After is a number of seconds (what the API sends) or an HTTP date.
    function parseRetryAfter(headers, now) {
        var raw = headerOf(headers, 'Retry-After');
        var seconds = NaN;

        if (typeof raw === 'number') {
            seconds = raw;
        } else if (typeof raw === 'string' && /^\s*[0-9]+\s*$/.test(raw)) {
            seconds = Number(raw);
        } else if (typeof raw === 'string' && raw.trim() !== '') {
            var date = Date.parse(raw);
            seconds = isNaN(date) ? NaN : Math.ceil((date - (typeof now === 'number' ? now : Date.now())) / 1000);
        }

        if (!isFinite(seconds) || seconds < 1) {
            return DEFAULT_RETRY_SECONDS;
        }
        return Math.min(Math.ceil(seconds), MAX_RETRY_SECONDS);
    }

    // The messages of the API are in English and meant for developers: only the kind of problem
    // is taken from them, never the text.
    function codeFromServerMessage(field, message) {
        var m = typeof message === 'string' ? message : '';

        if (field === 'contact') {
            return 'contact_required';
        }
        if (m.indexOf('is required for customer_type business_brand') !== -1) {
            return 'company_required';
        }
        if (m.indexOf('must be one of') !== -1) {
            return 'invalid_choice';
        }
        if (field === 'privacy_consent') {
            return 'consent_required';
        }
        if (field === 'privacy_consent_version') {
            return 'consent_version';
        }
        if (m.indexOf('must be at most') !== -1) {
            return 'too_long';
        }
        if (m.indexOf('valid email') !== -1) {
            return 'invalid_email';
        }
        if (m.indexOf('digits') !== -1) {
            return 'invalid_phone';
        }
        if (m.indexOf('control characters') !== -1) {
            return 'invalid_chars';
        }
        if (m.indexOf('is required') !== -1) {
            return field === 'customer_type' ? 'customer_type_required' : field === 'customer_name' ? 'name_required' : 'required';
        }
        return 'invalid';
    }

    function codeFromFileMessage(message) {
        var m = typeof message === 'string' ? message : '';

        if (m.indexOf('File is empty') !== -1) {
            return 'empty';
        }
        if (m.indexOf('File size exceeds') !== -1) {
            return 'too_large';
        }
        if (m.indexOf('is not allowed') !== -1) {
            return 'type_not_allowed';
        }
        if (m.indexOf('magic bytes') !== -1) {
            return 'content_mismatch';
        }
        if (m.indexOf('does not match MIME type') !== -1) {
            return 'type_mismatch';
        }
        return 'invalid';
    }

    function readValidation(body) {
        var fieldErrors = [];
        var fileErrors = [];
        var general = null;
        var details = body && Array.isArray(body.details) ? body.details : [];

        details.forEach(function (detail) {
            if (detail && typeof detail === 'object' && typeof detail.field === 'string') {
                fieldErrors.push({ field: detail.field, code: codeFromServerMessage(detail.field, detail.message) });
            } else if (detail && typeof detail === 'object' && typeof detail.filename === 'string') {
                var messages = Array.isArray(detail.errors) ? detail.errors : [];
                var codes = [];
                messages.forEach(function (message) {
                    var code = codeFromFileMessage(message);
                    if (codes.indexOf(code) === -1) {
                        codes.push(code);
                    }
                });
                fileErrors.push({ name: detail.filename, codes: codes.length > 0 ? codes : ['invalid'] });
            } else {
                general = 'specification';
            }
        });

        if (fieldErrors.length === 0 && fileErrors.length === 0 && general === null) {
            general = body && body.code === 'INVALID_JSON' ? 'invalid_json' : 'invalid_request';
        }
        return { kind: 'validation', fieldErrors: fieldErrors, fileErrors: fileErrors, general: general };
    }

    // Turns an answer into one of a few results. Only what the page needs is copied: whatever else
    // the answer carries (a token, an internal id or status, the scan state of a file) never
    // reaches the page.
    function interpretResponse(response, context) {
        var status = response && response.status;
        var body = response && response.body && typeof response.body === 'object' ? response.body : undefined;
        var hadFiles = !!(context && context.hadFiles);

        if (status === 201 && body && typeof body.receipt_id === 'string') {
            var files = [];
            (Array.isArray(body.files) ? body.files : []).forEach(function (file) {
                if (file && typeof file.filename === 'string') {
                    files.push({ name: file.filename, size: typeof file.size === 'number' ? file.size : null });
                }
            });
            return {
                kind: 'success',
                receiptId: body.receipt_id,
                createdAt: typeof body.created_at === 'string' ? body.created_at : null,
                message: typeof body.message === 'string' ? body.message : null,
                files: files
            };
        }
        if (status === 400) {
            return readValidation(body);
        }
        if (status === 429) {
            var fromBody = body && typeof body.retry_after_seconds === 'number' ? body.retry_after_seconds : undefined;
            var headerSeconds = headerOf(response.headers, 'Retry-After') !== undefined ? parseRetryAfter(response.headers) : undefined;
            return { kind: 'rateLimited', retryAfterSeconds: headerSeconds !== undefined ? headerSeconds : parseRetryAfter({ 'Retry-After': fromBody }) };
        }
        if (status === 503 && body && body.code === 'PRIVACY_CONSENT_NOT_CONFIGURED') {
            return { kind: 'notReady' };
        }
        if (typeof status === 'number' && status >= 500) {
            return { kind: 'serverError', mayHaveBeenSaved: hadFiles };
        }
        if (status === 201) {
            return { kind: 'serverError', mayHaveBeenSaved: true };
        }
        return { kind: 'unexpected', status: typeof status === 'number' ? status : null };
    }

    // Sends the request and always answers with a result, never with an exception. `fetch` is passed
    // in (window.fetch in the page, a fake in the tests).
    async function submitEstimate(options) {
        var request = options.request;
        var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 60000;
        var hadFiles = !!options.hadFiles;
        var controller = new AbortController();
        var timedOut = false;
        var timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            var init = Object.assign({}, request.init, { signal: controller.signal });
            var response = await options.fetch(request.url, init);
            var body;
            try {
                body = await response.json();
            } catch (parseError) {
                body = undefined;
            }
            return interpretResponse({ status: response.status, headers: response.headers, body: body }, { hadFiles: hadFiles });
        } catch (error) {
            return timedOut ? { kind: 'timeout', mayHaveBeenSaved: true } : { kind: 'network', mayHaveBeenSaved: true };
        } finally {
            clearTimeout(timer);
        }
    }

    // ------------------------------------------------------------------------------------------
    // Texts for the visitor. Plain text: render with textContent. None of them promises a time.

    var MESSAGES = Object.freeze({
        required: '필수 입력 항목이에요.',
        customer_type_required: '고객 유형을 선택해 주세요.',
        name_required: '이름을 입력해 주세요.',
        company_required: '회사명 또는 브랜드명을 입력해 주세요.',
        contact_required: '이메일 또는 전화번호 중 하나는 꼭 입력해 주세요.',
        invalid_email: '이메일 형식을 확인해 주세요.',
        invalid_phone: '전화번호는 숫자 7~15자리로 입력해 주세요. 숫자, 공백, +, -, ( )만 쓸 수 있어요.',
        too_long: '{max}자 이내로 입력해 주세요.',
        invalid_chars: '사용할 수 없는 문자가 들어 있어요.',
        invalid_choice: '목록에서 선택해 주세요.',
        consent_required: '개인정보 수집·이용에 동의해 주세요.',
        consent_version: '동의 안내문을 다시 불러온 뒤 시도해 주세요.',
        quantity_invalid: '수량은 1 이상의 숫자로 입력해 주세요. (최대 1,000,000)',
        choice_required: '선택해 주세요. 잘 모르겠다면 ‘' + UNKNOWN_LABEL + '’을 골라도 돼요.',
        sizes_required: '사이즈를 1개 이상 선택해 주세요.',
        description_required: '제품 설명을 입력해 주세요.',
        invalid_number: '숫자로 입력해 주세요.',
        invalid_date: '날짜를 확인해 주세요.',
        invalid: '입력한 내용을 확인해 주세요.',

        file_type_not_allowed: '{name}: JPG, PNG, PDF 파일만 첨부할 수 있어요.',
        file_type_unknown: '{name}: 파일 형식을 확인할 수 없어요. 다른 파일로 바꿔 주세요.',
        file_type_mismatch: '{name}: 파일 형식을 확인할 수 없어요. 다른 파일로 바꿔 주세요.',
        file_too_large: '{name}: 파일당 10MB까지 첨부할 수 있어요.',
        file_empty: '{name}: 비어 있는 파일이에요.',
        file_too_many: '파일은 최대 5개까지 첨부할 수 있어요.',
        file_total_too_large: '첨부 파일 전체 크기는 30MB까지예요.',
        file_duplicate: '{name}: 이미 선택한 파일과 같은 파일일 수 있어요.',
        file_content_mismatch: '{name}: 파일 내용이 형식과 맞지 않아요. 다른 파일로 바꿔 주세요.',
        file_invalid: '{name}: 이 파일은 첨부할 수 없어요. 다른 파일로 바꿔 주세요.',

        rate_limited: '요청이 많아 잠시 접수를 받을 수 없어요. 약 {minutes}분 뒤에 다시 시도해 주세요.',
        not_ready: '지금은 견적 접수를 준비하고 있어요. 전화나 이메일로 문의해 주세요.',
        server_error: '일시적인 문제가 생겼어요. 입력하신 내용은 그대로 남아 있으니 잠시 뒤 다시 시도해 주세요.',
        server_error_files: '파일을 보내는 중 문제가 생겼어요. 문의가 이미 접수되었을 수 있으니, 다시 보내기 전에 전화나 이메일로 확인해 주세요.',
        network: '인터넷 연결을 확인한 뒤 다시 시도해 주세요. 이미 접수되었을 수 있으니 중복 접수가 걱정되면 전화나 이메일로 확인해 주세요.',
        invalid_request: '입력한 내용을 확인한 뒤 다시 시도해 주세요.',
        specification: '제품 정보를 확인한 뒤 다시 시도해 주세요.',
        unexpected: '요청을 처리하지 못했어요. 입력하신 내용은 그대로 남아 있으니 잠시 뒤 다시 시도해 주세요.'
    });

    var FILE_CODE_TO_MESSAGE = Object.freeze({
        type_not_allowed: 'file_type_not_allowed',
        type_unknown: 'file_type_unknown',
        type_mismatch: 'file_type_mismatch',
        too_large: 'file_too_large',
        empty: 'file_empty',
        too_many: 'file_too_many',
        total_too_large: 'file_total_too_large',
        duplicate: 'file_duplicate',
        content_mismatch: 'file_content_mismatch',
        invalid: 'file_invalid'
    });

    // The text for a code. `params` may hold name (a file name), max and minutes. The values are
    // put in as they are: the caller shows the whole text with textContent.
    function messageFor(code, params) {
        var values = params || {};
        var template = hasOwn(MESSAGES, code) ? MESSAGES[code] : MESSAGES.invalid;
        return template.replace(/\{(name|max|minutes)\}/g, function (_match, key) {
            return values[key] === undefined ? '' : String(values[key]);
        });
    }

    function messageForFile(code, name) {
        var key = hasOwn(FILE_CODE_TO_MESSAGE, code) ? FILE_CODE_TO_MESSAGE[code] : 'file_invalid';
        return messageFor(key, { name: name });
    }

    // The text for a result of interpretResponse / submitEstimate that is not a success or a
    // validation error (those are shown field by field).
    function messageForResult(result) {
        if (!result) {
            return messageFor('unexpected');
        }
        switch (result.kind) {
            case 'rateLimited':
                return messageFor('rate_limited', { minutes: Math.max(1, Math.ceil(result.retryAfterSeconds / 60)) });
            case 'notReady':
                return messageFor('not_ready');
            case 'serverError':
                return messageFor(result.mayHaveBeenSaved ? 'server_error_files' : 'server_error');
            case 'network':
            case 'timeout':
                return messageFor('network');
            case 'validation':
                return messageFor(result.general === 'specification' ? 'specification' : 'invalid_request');
            default:
                return messageFor('unexpected');
        }
    }

    var api = Object.freeze({
        PAGES: PAGES,
        SCHEMA_VERSION: SCHEMA_VERSION,
        UNKNOWN: UNKNOWN,
        UNKNOWN_LABEL: UNKNOWN_LABEL,
        OPTIONS: OPTIONS,
        CUSTOMER_TYPES: CUSTOMER_TYPES,
        CUSTOMER_TYPE_HINT: CUSTOMER_TYPE_HINT,
        LIMITS: LIMITS,
        FILE_POLICY: FILE_POLICY,
        normalizeCategory: normalizeCategory,
        validateSpecInput: validateSpecInput,
        buildSpecification: buildSpecification,
        validateCustomer: validateCustomer,
        validateFiles: validateFiles,
        buildRequest: buildRequest,
        interpretResponse: interpretResponse,
        submitEstimate: submitEstimate,
        parseRetryAfter: parseRetryAfter,
        messageFor: messageFor,
        messageForFile: messageForFile,
        messageForResult: messageForResult
    });

    globalThis.BridgePathEstimate = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
