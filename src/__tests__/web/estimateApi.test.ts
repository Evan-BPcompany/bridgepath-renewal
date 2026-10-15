import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../../estimate-api.js');
const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'estimate-api.js'), 'utf8');

const MB = 1024 * 1024;
const g = globalThis as any;

const file = (name: string, size = 1000, type?: string) => ({
  name,
  size,
  type: type ?? (/\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg')
});

const codesOf = (errors: Array<{ field: string; code: string }>) => errors.map(e => `${e.field}:${e.code}`);

const validCustomer = {
  customer_type: 'individual_startup',
  customer_name: 'Kim',
  customer_email: 'buyer@example.com',
  privacy_consent: true
};

afterAll(() => {
  delete g.BridgePathEstimate;
});

describe('estimate-api.js: the module', () => {
  it('is plain text logic: no DOM, no HTML', () => {
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\binnerHTML\b|\binsertAdjacentHTML\b|\bdocument\./);
    expect(code).not.toMatch(/\bwindow\./);
    expect(code).not.toMatch(/\bconsole\./); // never logs what the visitor typed
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('puts itself on globalThis and exports for CommonJS only when module exists', () => {
    expect(g.BridgePathEstimate).toBe(api);
    expect(source).toContain('globalThis.BridgePathEstimate = api');
    expect(source).toContain("typeof module !== 'undefined' && module.exports");
    expect(Object.isFrozen(api)).toBe(true);
  });
});

describe('the values of the existing forms', () => {
  // The module and the pages must agree on the values of the select boxes and the check boxes. The
  // pages get an "unknown" option later; until then the rest of the list has to be the same.
  const page = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', name), 'utf8');
  const optionsOf = (html: string, id: string): string[] => {
    const select = html.match(new RegExp('<select id="' + id + '"[\\s\\S]*?</select>'));
    expect(select).not.toBeNull();
    return [...select![0].matchAll(/<option value="([^"]*)"/g)].map(match => match[1]).filter(value => value !== '' && value !== 'unknown');
  };

  it.each([
    ['sunglasses-estimate.html', 'lensType', 'lensType'],
    ['sunglasses-estimate.html', 'frameMaterial', 'frameMaterial'],
    ['shoes-estimate.html', 'material', 'shoesMaterial'],
    ['golf-estimate.html', 'material', 'golfMaterial']
  ])('%s: the select %s has the values of OPTIONS.%s', (file, id, key) => {
    expect(optionsOf(page(file), id)).toEqual(api.OPTIONS[key].filter((value: string) => value !== 'unknown'));
  });

  it('shoes-estimate.html offers the sizes of OPTIONS.shoeSizes', () => {
    const sizes = [...page('shoes-estimate.html').matchAll(/<input type="checkbox" name="size" value="(\d+)"/g)].map(match => Number(match[1]));
    expect(sizes).toEqual([...api.OPTIONS.shoeSizes]);
  });

  it('the cards of the pages are the kinds of product of PAGES', () => {
    for (const [file, key] of [['sunglasses-estimate.html', 'sunglasses'], ['shoes-estimate.html', 'shoes'], ['golf-estimate.html', 'golf']]) {
      const cards = [...page(file).matchAll(/class="category-card" data-category="([^"]+)"/g)].map(match => match[1]);
      expect(cards).toEqual([...api.PAGES[key].subtypes]);
    }
  });
});

describe('categories', () => {
  it.each([
    ['sunglasses', ['optical', 'sunglasses', 'sports', 'kids', 'safety'], 'eyewear'],
    ['shoes', ['sneakers', 'heels', 'mens', 'boots', 'sandals', 'other'], 'shoes'],
    ['golf', ['bags', 'gloves', 'headwear', 'accessories', 'covers', 'training'], 'golf_products']
  ])('%s: every kind of product is sent as the category %s', (page, subtypes, category) => {
    for (const subtype of subtypes) {
      expect(api.normalizeCategory(page, subtype)).toEqual({ category, subtype });
    }
    expect([...api.PAGES[page].subtypes]).toEqual(subtypes);
  });

  it('the last card of the shoes page ("기타") is a kind of shoe, not the category other', () => {
    expect(api.normalizeCategory('shoes', 'other')).toEqual({ category: 'shoes', subtype: 'other' });
    expect(api.buildSpecification('shoes', 'other', { material: 'unknown', sizes: ['240'], quantity: '1' }).spec.shoe_type).toBe('other');
  });

  it('other has no kind of product and is the category other', () => {
    expect(api.normalizeCategory('other')).toEqual({ category: 'other', subtype: null });
    expect(api.normalizeCategory('other', '')).toEqual({ category: 'other', subtype: null });
    expect(api.normalizeCategory('other', 'bags')).toBeNull();
  });

  it.each([
    ['sunglasses', 'sneakers'],
    ['shoes', 'optical'],
    ['golf', ''],
    ['golf', undefined],
    ['golf', 'Bags'],
    ['nope', 'bags'],
    [undefined, 'bags'],
    ['__proto__', 'x'],
    ['constructor', 'x']
  ])('refuses the unknown combination %s / %s', (page, subtype) => {
    expect(api.normalizeCategory(page, subtype)).toBeNull();
  });

  it('the category sent is always one of the four the database allows', () => {
    const allowed = ['eyewear', 'shoes', 'golf_products', 'other'];
    for (const page of Object.keys(api.PAGES)) {
      expect(allowed).toContain(api.PAGES[page].category);
    }
  });
});

describe('specification: sunglasses', () => {
  const base = { frameMaterial: 'metal', lensType: 'polarized', quantity: '1000' };

  it('builds the specification of the API from the form', () => {
    const result = api.buildSpecification('sunglasses', 'sports', {
      ...base,
      frameColor: ' 검정 ',
      lensColor: '갈색',
      bridgeWidth: '20',
      armLength: '145.5',
      lensWidth: '56',
      deliveryDate: '2026-12-31',
      additionalInfo: 'UV 차단'
    });

    expect(result).toEqual({
      ok: true,
      spec: {
        schema_version: '1.0',
        quantity: 1000,
        frame_type: 'sports',
        material: 'metal',
        lens_type: 'polarized',
        frame_color: '검정',
        lens_color: '갈색',
        bridge_width_mm: 20,
        arm_length_mm: 145.5,
        lens_width_mm: 56,
        additional_info: 'UV 차단',
        delivery_date: '2026-12-31'
      }
    });
  });

  it('leaves out what was not filled in', () => {
    const { spec } = api.buildSpecification('sunglasses', 'optical', {
      ...base, frameColor: '  ', bridgeWidth: '', deliveryDate: '', additionalInfo: undefined
    });

    expect(Object.keys(spec).sort()).toEqual(['frame_type', 'lens_type', 'material', 'quantity', 'schema_version']);
  });

  it('takes "unknown" for the frame material and the lens type as a value', () => {
    const { spec } = api.buildSpecification('sunglasses', 'kids', { ...base, frameMaterial: 'unknown', lensType: 'unknown' });

    expect(spec.material).toBe('unknown');
    expect(spec.lens_type).toBe('unknown');
  });

  it('requires the frame material and the lens type, and takes only the listed values', () => {
    expect(codesOf(api.validateSpecInput('sunglasses', 'optical', { quantity: '5' }).errors)).toEqual([
      'frameMaterial:choice_required',
      'lensType:choice_required'
    ]);
    expect(
      codesOf(api.validateSpecInput('sunglasses', 'optical', { ...base, frameMaterial: 'gold', lensType: 'x' }).errors)
    ).toEqual(['frameMaterial:invalid_choice', 'lensType:invalid_choice']);
  });

  it.each(['-1', 'abc', '1e3', '1,5', '1000000.1', '100001'])('refuses the dimension %j', value => {
    expect(codesOf(api.validateSpecInput('sunglasses', 'optical', { ...base, bridgeWidth: value }).errors)).toEqual([
      'bridgeWidth:invalid_number'
    ]);
  });

  it('refuses a text that is too long', () => {
    expect(
      codesOf(api.validateSpecInput('sunglasses', 'optical', { ...base, frameColor: 'x'.repeat(101) }).errors)
    ).toEqual(['frameColor:too_long']);
    expect(api.validateSpecInput('sunglasses', 'optical', { ...base, frameColor: 'x'.repeat(100) }).valid).toBe(true);
    expect(
      api.validateSpecInput('sunglasses', 'optical', { ...base, additionalInfo: 'x'.repeat(2001) }).errors[0]
    ).toMatchObject({ field: 'additionalInfo', code: 'too_long', max: 2000 });
  });
});

describe('specification: shoes', () => {
  const base = { material: 'leather', sizes: ['240', '230', '270'], quantity: 500 };

  it('builds the size range from the sizes that were ticked', () => {
    const { spec } = api.buildSpecification('shoes', 'sneakers', { ...base, color: '흰색', additionalInfo: '특수 밑창' });

    expect(spec).toEqual({
      schema_version: '1.0',
      quantity: 500,
      shoe_type: 'sneakers',
      material: 'leather',
      sizes: [230, 240, 270],
      size_range: '230-270',
      color: '흰색',
      special_requirements: '특수 밑창'
    });
  });

  it('a single size is its own range, a repeated size counts once', () => {
    expect(api.buildSpecification('shoes', 'boots', { ...base, sizes: ['250'] }).spec.size_range).toBe('250');
    expect(api.buildSpecification('shoes', 'boots', { ...base, sizes: ['250', '250'] }).spec.sizes).toEqual([250]);
  });

  it('requires a size, a material and a quantity; refuses sizes the form does not offer', () => {
    expect(codesOf(api.validateSpecInput('shoes', 'heels', { quantity: '1' }).errors)).toEqual([
      'material:choice_required',
      'sizes:sizes_required'
    ]);
    expect(codesOf(api.validateSpecInput('shoes', 'heels', { ...base, sizes: ['235'] }).errors)).toEqual(['sizes:invalid_choice']);
    expect(codesOf(api.validateSpecInput('shoes', 'heels', { ...base, sizes: 'not-a-list' }).errors)).toEqual(['sizes:sizes_required']);
  });
});

describe('specification: golf and other', () => {
  it('golf: the design option is the customization, the colour and the size are kept', () => {
    const { spec } = api.buildSpecification('golf', 'gloves', {
      material: 'leather', quantity: '300', color: '흰색', size: 'M/L', design: '로고 인쇄', additionalInfo: '포장'
    });

    expect(spec).toEqual({
      schema_version: '1.0',
      quantity: 300,
      product_type: 'gloves',
      material: 'leather',
      color: '흰색',
      size: 'M/L',
      customization: '로고 인쇄',
      additional_info: '포장'
    });
  });

  it('golf: the material is required and may be "unknown"', () => {
    expect(codesOf(api.validateSpecInput('golf', 'bags', { quantity: '1' }).errors)).toEqual(['material:choice_required']);
    expect(api.validateSpecInput('golf', 'bags', { quantity: '1', material: 'unknown' }).valid).toBe(true);
  });

  it('other: the description and the quantity are what the API needs', () => {
    expect(api.buildSpecification('other', null, { productDescription: '  텀블러  ', quantity: '10' })).toEqual({
      ok: true,
      spec: { schema_version: '1.0', quantity: 10, product_description: '텀블러' }
    });
    expect(codesOf(api.validateSpecInput('other', null, { quantity: '10' }).errors)).toEqual(['productDescription:description_required']);
    expect(
      codesOf(api.validateSpecInput('other', null, { quantity: '10', productDescription: 'x'.repeat(2001) }).errors)
    ).toEqual(['productDescription:too_long']);
  });

  it('refuses an unknown page or kind of product', () => {
    expect(api.validateSpecInput('golf', 'sneakers', { material: 'metal', quantity: '1' })).toEqual({
      valid: false,
      errors: [{ field: 'category', code: 'invalid_choice' }]
    });
  });
});

describe('quantity (a required number)', () => {
  const run = (quantity: unknown) =>
    api.validateSpecInput('other', null, { productDescription: 'x', quantity }).errors.map((e: { code: string }) => e.code);

  it.each(['1', '10', '1000000', ' 25 ', 1, 999999, '0007'])('accepts %j', quantity => {
    expect(run(quantity)).toEqual([]);
  });

  it.each(['', '  ', undefined, null, '0', '-1', '1000001', '1.5', '1e3', '1,000', 'abc', '10개', '１０', {}, [], 0, 1.5, NaN])(
    'refuses %j',
    quantity => {
      expect(run(quantity)).toEqual(['quantity_invalid']);
    }
  );

  it('sends a number, not the text of the input', () => {
    expect(api.buildSpecification('other', null, { productDescription: 'x', quantity: '12' }).spec.quantity).toBe(12);
  });
});

describe('delivery date', () => {
  const run = (deliveryDate: string) =>
    api.validateSpecInput('other', null, { productDescription: 'x', quantity: '1', deliveryDate }).errors.map((e: { code: string }) => e.code);

  it('is optional and must be a real date', () => {
    expect(run('')).toEqual([]);
    expect(run('2028-02-29')).toEqual([]);
    for (const bad of ['2027-02-29', '2026-13-01', '2026-00-10', '26-10-10', '2026/10/10', 'tomorrow']) {
      expect(run(bad)).toEqual(['invalid_date']);
    }
  });
});

describe('the input is not changed', () => {
  it('buildSpecification and validateCustomer leave their arguments alone', () => {
    const values = { material: 'leather', sizes: ['240', '230'], quantity: '5' };
    const copy = JSON.parse(JSON.stringify(values));
    const customer = { ...validCustomer, customer_name: '  Kim  ' };
    const customerCopy = JSON.parse(JSON.stringify(customer));

    api.buildSpecification('shoes', 'boots', values);
    api.validateCustomer(customer);

    expect(values).toEqual(copy);
    expect(customer).toEqual(customerCopy);
  });
});

describe('customer details', () => {
  const run = (overrides: Record<string, unknown>) => api.validateCustomer({ ...validCustomer, ...overrides });

  it('accepts a complete individual request and returns trimmed values', () => {
    const result = run({ customer_name: '  Kim  ', customer_email: ' buyer@example.com ', customer_phone: '', company_name: ' ' });

    expect(result).toEqual({
      valid: true,
      errors: [],
      value: { customer_type: 'individual_startup', customer_name: 'Kim', customer_email: 'buyer@example.com' }
    });
  });

  it('knows the two customer types and their labels', () => {
    expect({ ...api.CUSTOMER_TYPES }).toEqual({
      individual_startup: '개인·창업 준비 중',
      business_brand: '사업자·브랜드 운영 중'
    });
    expect(api.CUSTOMER_TYPE_HINT).toContain('일반 소비자용이 아니에요');
  });

  it.each([undefined, null, '', '   '])('requires the customer type (%j)', value => {
    expect(codesOf(run({ customer_type: value }).errors)).toEqual(['customer_type:customer_type_required']);
  });

  it.each(['individual', 'business', 'Individual_Startup', 'x', 1])('refuses the customer type %j', value => {
    expect(codesOf(run({ customer_type: value as string }).errors)).toHaveLength(1);
  });

  it('requires a name for both types', () => {
    for (const type of ['individual_startup', 'business_brand']) {
      for (const name of [undefined, null, '', '   ']) {
        expect(codesOf(run({ customer_type: type, company_name: 'Acme', customer_name: name }).errors)).toEqual([
          'customer_name:name_required'
        ]);
      }
    }
  });

  it('requires a company or brand name for business_brand only', () => {
    expect(run({ customer_type: 'individual_startup' }).valid).toBe(true);
    expect(run({ customer_type: 'individual_startup', company_name: 'My brand' }).valid).toBe(true);
    for (const company of [undefined, null, '', '  ']) {
      expect(codesOf(run({ customer_type: 'business_brand', company_name: company }).errors)).toEqual([
        'company_name:company_required'
      ]);
    }
    expect(run({ customer_type: 'business_brand', company_name: ' Acme ' }).value.company_name).toBe('Acme');
  });

  it('checks the lengths: 100 passes, 101 does not', () => {
    expect(run({ customer_name: 'x'.repeat(100) }).valid).toBe(true);
    expect(run({ customer_name: 'x'.repeat(101) }).errors).toEqual([{ field: 'customer_name', code: 'too_long', max: 100 }]);
    expect(run({ customer_type: 'business_brand', company_name: 'x'.repeat(101) }).errors).toEqual([
      { field: 'company_name', code: 'too_long', max: 100 }
    ]);
    expect(run({ customer_email: `${'a'.repeat(90)}@example.com` }).errors).toEqual([
      { field: 'customer_email', code: 'too_long', max: 100 }
    ]);
  });

  describe('contact', () => {
    it('an e-mail alone or a phone number alone is enough', () => {
      expect(run({ customer_email: undefined, customer_phone: '010-1234-5678' }).valid).toBe(true);
      expect(run({ customer_email: 'a@b.co', customer_phone: undefined }).valid).toBe(true);
    });

    it('needs one of them, reported as "contact"', () => {
      expect(codesOf(run({ customer_email: undefined }).errors)).toEqual(['contact:contact_required']);
      expect(codesOf(run({ customer_email: '  ', customer_phone: '' }).errors)).toEqual(['contact:contact_required']);
    });

    it('does not report a missing contact when one of them is there but wrong', () => {
      expect(codesOf(run({ customer_email: 'nope' }).errors)).toEqual(['customer_email:invalid_email']);
    });

    it.each(['a@b', 'a b@c.de', '@x.com', 'a@@b.co', 'plain'])('refuses the e-mail %j', email => {
      expect(codesOf(run({ customer_email: email }).errors)).toEqual(['customer_email:invalid_email']);
    });

    it.each([
      ['010-1234-5678', true],
      ['+82 10 1234 5678', true],
      ['(02) 123-4567', true],
      ['1234567', true],
      ['123456', false],
      ['123456789012345', true],
      ['1234567890123456', false],
      ['010+1234567', false],
      ['010-1234-567a', false],
      ['abc', false]
    ])('the phone number %j is valid: %s', (phone, valid) => {
      expect(run({ customer_email: undefined, customer_phone: phone }).valid).toBe(valid);
    });

    it('limits the phone number to 20 characters', () => {
      expect(run({ customer_email: undefined, customer_phone: '1'.repeat(21) }).errors).toEqual([
        { field: 'customer_phone', code: 'too_long', max: 20 }
      ]);
    });
  });

  it('refuses control characters in a text', () => {
    expect(codesOf(run({ customer_name: 'Ki\u0000m' }).errors)).toEqual(['customer_name:invalid_chars']);
    expect(codesOf(run({ customer_type: 'business_brand', company_name: 'A\u0007' }).errors)).toEqual([
      'company_name:invalid_chars'
    ]);
  });

  it('the consent must be the boolean true', () => {
    expect(run({ privacy_consent: true }).valid).toBe(true);
    for (const value of [undefined, null, false, 'true', 1, 'on', 0]) {
      expect(codesOf(run({ privacy_consent: value }).errors)).toEqual(['privacy_consent:consent_required']);
    }
  });

  it('reports every problem at once and never repeats what was typed', () => {
    const result = api.validateCustomer({ customer_name: 'SECRET-NAME\u0001', customer_email: 'secret@@mail', privacy_consent: false });

    expect(result.valid).toBe(false);
    expect(codesOf(result.errors).sort()).toEqual([
      'customer_email:invalid_email',
      'customer_name:invalid_chars',
      'customer_type:customer_type_required',
      'privacy_consent:consent_required'
    ].sort());
    expect(JSON.stringify(result)).not.toMatch(/SECRET-NAME|secret@@mail/);
  });

  it('tolerates a missing argument', () => {
    expect(api.validateCustomer(undefined).valid).toBe(false);
    expect(api.validateCustomer(null).valid).toBe(false);
  });
});

describe('files', () => {
  it('uses the policy of the PRD: 5 files, 10 MB each, 30 MB together, JPG/PNG/PDF', () => {
    expect(api.FILE_POLICY.maxFiles).toBe(5);
    expect(api.FILE_POLICY.maxFileBytes).toBe(10 * MB);
    expect(api.FILE_POLICY.maxTotalBytes).toBe(30 * MB);
    expect({ ...api.FILE_POLICY.types }).toEqual({
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      pdf: 'application/pdf'
    });
  });

  it.each([
    ['logo.jpg', 'image/jpeg'],
    ['logo.JPG', 'image/jpeg'],
    ['logo.jpeg', 'image/jpeg'],
    ['logo.png', 'image/png'],
    ['sheet.pdf', 'application/pdf'],
    ['my.logo.v2.png', 'image/png']
  ])('accepts %s as %s', (name, type) => {
    const result = api.validateFiles([], [file(name, 1000, type)]);
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it.each([
    ['photo.webp', 'image/webp', 'type_not_allowed'],
    ['anim.gif', 'image/gif', 'type_not_allowed'],
    ['run.exe', 'application/octet-stream', 'type_not_allowed'],
    ['archive.zip', 'application/zip', 'type_not_allowed'],
    ['noextension', 'image/png', 'type_not_allowed'],
    ['logo.png', 'image/jpeg', 'type_mismatch'],
    ['logo.jpg', 'image/png', 'type_mismatch'],
    ['sheet.pdf', 'image/png', 'type_mismatch'],
    ['logo.png', 'image/jpg', 'type_not_allowed'],
    ['logo.png', '', 'type_unknown'],
    ['logo.exe', '', 'type_not_allowed']
  ])('refuses %s with the type %j (%s): the extension and the type must both match', (name, type, code) => {
    const result = api.validateFiles([], [file(name, 1000, type)]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([{ name, code }]);
  });

  it('refuses an empty file and a file over 10 MB; 10 MB exactly passes', () => {
    expect(api.validateFiles([], [file('a.png', 0)]).rejected).toEqual([{ name: 'a.png', code: 'empty' }]);
    expect(api.validateFiles([], [file('a.png', 10 * MB + 1)]).rejected).toEqual([{ name: 'a.png', code: 'too_large' }]);
    expect(api.validateFiles([], [file('a.png', 10 * MB)]).accepted).toHaveLength(1);
  });

  it('takes the first five in the order chosen and refuses the sixth', () => {
    const six = ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png'].map(name => file(name));

    const result = api.validateFiles([], six);

    expect(result.accepted.map((f: { name: string }) => f.name)).toEqual(['1.png', '2.png', '3.png', '4.png', '5.png']);
    expect(result.rejected).toEqual([{ name: '6.png', code: 'too_many' }]);
    expect(result.count).toBe(5);
  });

  it('counts the files already selected', () => {
    const selected = [file('a.png'), file('b.png'), file('c.png'), file('d.png')];

    const result = api.validateFiles(selected, [file('e.png'), file('f.png')]);

    expect(result.accepted.map((f: { name: string }) => f.name)).toEqual(['e.png']);
    expect(result.rejected).toEqual([{ name: 'f.png', code: 'too_many' }]);
  });

  it('limits the total to 30 MB: exactly 30 MB passes, one byte more does not', () => {
    const three = [file('a.pdf', 10 * MB), file('b.pdf', 10 * MB), file('c.pdf', 10 * MB)];
    expect(api.validateFiles([], three).accepted).toHaveLength(3);
    expect(api.validateFiles([], three).totalBytes).toBe(30 * MB);

    const result = api.validateFiles([file('a.pdf', 10 * MB), file('b.pdf', 10 * MB), file('c.pdf', 10 * MB - 1)], [file('d.png', 2)]);
    expect(result.rejected).toEqual([{ name: 'd.png', code: 'total_too_large' }]);
  });

  it('a rejected file does not use up the count or the size', () => {
    const result = api.validateFiles([], [file('bad.gif', 20 * MB, 'image/gif'), file('a.png', 20 * MB + 1), file('ok.png', 10 * MB)]);

    expect(result.accepted.map((f: { name: string }) => f.name)).toEqual(['ok.png']);
    expect(result.totalBytes).toBe(10 * MB);
    expect(result.count).toBe(1);
  });

  it('marks the same file chosen twice (same name and size), but still accepts it', () => {
    const result = api.validateFiles([file('logo.png', 500)], [file('logo.png', 500), file('logo.png', 600)]);

    expect(result.duplicates).toEqual(['logo.png']);
    expect(result.accepted).toHaveLength(2);
  });

  it('tolerates missing arguments', () => {
    expect(api.validateFiles(undefined, undefined)).toEqual({ accepted: [], rejected: [], duplicates: [], totalBytes: 0, count: 0 });
  });
});

describe('the request', () => {
  const customerValue = {
    customer_type: 'business_brand',
    customer_name: 'Kim',
    company_name: 'Acme',
    customer_email: 'buyer@example.com'
  };
  const spec = api.buildSpecification('golf', 'bags', { material: 'nylon', quantity: '50' }).spec;
  const options = (files: unknown[] = []) => ({
    apiBase: 'http://localhost:4000/',
    page: 'golf',
    subtype: 'bags',
    spec,
    customer: customerValue,
    consentVersion: 'dev-draft',
    files
  });

  it('without files: JSON, the consent is the boolean true, the category is the normalised one', () => {
    const { url, init } = api.buildRequest(options());

    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).toEqual({
      category: 'golf_products',
      customer_type: 'business_brand',
      customer_name: 'Kim',
      company_name: 'Acme',
      customer_email: 'buyer@example.com',
      privacy_consent_version: 'dev-draft',
      specification_json: spec,
      privacy_consent: true
    });
  });

  it('never sends the kind of product as the category', () => {
    const { init } = api.buildRequest(options());

    expect(JSON.parse(init.body).category).not.toBe('bags');
    expect(JSON.parse(init.body).specification_json.product_type).toBe('bags');
  });

  it('leaves out the fields that are empty', () => {
    const { init } = api.buildRequest({ ...options(), customer: { customer_type: 'individual_startup', customer_name: 'Lee', customer_phone: '010-1234-5678' } });

    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual([
      'category', 'customer_name', 'customer_phone', 'customer_type', 'privacy_consent',
      'privacy_consent_version', 'specification_json'
    ]);
  });

  it('with files: a form, the consent is the text "true", the specification is a JSON string, no Content-Type', () => {
    const logo = new g.File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    const sheet = new g.File([new Uint8Array([4, 5])], 'sheet.pdf', { type: 'application/pdf' });

    const { url, init } = api.buildRequest(options([logo, sheet]));

    expect(url).toBe('http://localhost:4000/api/estimates');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.body).toBeInstanceOf(g.FormData);
    const form = init.body as FormData;
    expect(form.get('category')).toBe('golf_products');
    expect(form.get('customer_type')).toBe('business_brand');
    expect(form.get('privacy_consent')).toBe('true');
    expect(form.get('privacy_consent_version')).toBe('dev-draft');
    expect(JSON.parse(String(form.get('specification_json')))).toEqual(spec);
    expect(form.getAll('files').map((f: any) => f.name)).toEqual(['logo.png', 'sheet.pdf']);
    expect(form.has('customer_phone')).toBe(false);
    expect(init.credentials).toBe('omit');
  });

  it('a slash at the end of the address does not double', () => {
    expect(api.buildRequest({ ...options(), apiBase: 'https://api.example.test///' }).url).toBe('https://api.example.test/api/estimates');
    expect(api.buildRequest({ ...options(), apiBase: 'https://api.example.test' }).url).toBe('https://api.example.test/api/estimates');
  });

  it('refuses programming mistakes instead of sending a wrong request', () => {
    expect(() => api.buildRequest({ ...options(), subtype: 'sneakers' })).toThrow(TypeError);
    expect(() => api.buildRequest({ ...options(), page: 'nope' })).toThrow(TypeError);
    expect(() => api.buildRequest({ ...options(), spec: undefined })).toThrow(TypeError);
  });
});

describe('the answer', () => {
  const created = {
    success: true,
    receipt_id: 'BP20261013001',
    created_at: '2026-10-13T03:00:00.000Z',
    message: '견적 요청이 정상적으로 접수되었습니다.',
    // Things the page must never get:
    access_token: 'a'.repeat(64),
    status: 'new_receipt',
    estimate_id: 'internal-uuid',
    files: [{ id: 'f1', filename: 'logo.png', size: 12, status: 'quarantine', s3Key: 'secret/key' }]
  };

  it('201: the receipt number, the time, the message and the names of the files', () => {
    const result = api.interpretResponse({ status: 201, headers: {}, body: created });

    expect(result).toEqual({
      kind: 'success',
      receiptId: 'BP20261013001',
      createdAt: '2026-10-13T03:00:00.000Z',
      message: '견적 요청이 정상적으로 접수되었습니다.',
      files: [{ name: 'logo.png', size: 12 }]
    });
  });

  it('201: no token, no internal status, no id, no scan state reaches the page', () => {
    const text = JSON.stringify(api.interpretResponse({ status: 201, headers: {}, body: created }));

    expect(text).not.toMatch(/access_token|aaaaaaaa|new_receipt|status|estimate_id|internal-uuid|quarantine|s3Key|secret\/key/);
  });

  it('201 without a receipt number is not taken for a success', () => {
    expect(api.interpretResponse({ status: 201, headers: {}, body: { success: true } }).kind).toBe('serverError');
    expect(api.interpretResponse({ status: 201, headers: {}, body: undefined }).kind).toBe('serverError');
  });

  it('400 on the customer: the fields, as codes', () => {
    const result = api.interpretResponse({
      status: 400,
      headers: {},
      body: {
        error: 'Invalid customer information',
        details: [
          { field: 'customer_type', message: 'must be one of: individual_startup, business_brand' },
          { field: 'customer_name', message: 'is required' },
          { field: 'company_name', message: 'is required for customer_type business_brand' },
          { field: 'customer_email', message: 'must be a valid email address' },
          { field: 'customer_phone', message: 'must contain 7-15 digits and only digits, spaces, +, -, ( )' },
          { field: 'privacy_consent', message: 'must be true' },
          { field: 'privacy_consent_version', message: 'is not an accepted consent version' },
          { field: 'customer_name', message: 'must be at most 100 characters' },
          { field: 'company_name', message: 'contains invalid control characters' }
        ]
      }
    });

    expect(result.kind).toBe('validation');
    expect(result.fieldErrors).toEqual([
      { field: 'customer_type', code: 'invalid_choice' },
      { field: 'customer_name', code: 'name_required' },
      { field: 'company_name', code: 'company_required' },
      { field: 'customer_email', code: 'invalid_email' },
      { field: 'customer_phone', code: 'invalid_phone' },
      { field: 'privacy_consent', code: 'consent_required' },
      { field: 'privacy_consent_version', code: 'consent_version' },
      { field: 'customer_name', code: 'too_long' },
      { field: 'company_name', code: 'invalid_chars' }
    ]);
    expect(result.general).toBeNull();
  });

  it('400 on the contact: "contact"', () => {
    const result = api.interpretResponse({
      status: 400,
      headers: {},
      body: {
        error: 'Missing required contact: customer_email or customer_phone',
        details: [{ field: 'contact', message: 'at least one of customer_email or customer_phone is required' }]
      }
    });

    expect(result.fieldErrors).toEqual([{ field: 'contact', code: 'contact_required' }]);
  });

  it('400 on the files: file by file', () => {
    const result = api.interpretResponse({
      status: 400,
      headers: {},
      body: {
        error: 'File validation failed',
        details: [
          { filename: 'a.png', errors: ['File magic bytes do not match MIME type'] },
          { filename: 'b.png', errors: ['File size exceeds 50MB limit', 'File extension .png does not match MIME type image/jpeg'] },
          { filename: 'c.pdf', errors: ['File is empty'] },
          { filename: 'd.gif', errors: ['MIME type image/gif is not allowed'] }
        ]
      }
    });

    expect(result.fileErrors).toEqual([
      { name: 'a.png', codes: ['content_mismatch'] },
      { name: 'b.png', codes: ['too_large', 'type_mismatch'] },
      { name: 'c.pdf', codes: ['empty'] },
      { name: 'd.gif', codes: ['type_not_allowed'] }
    ]);
    expect(result.fieldErrors).toEqual([]);
  });

  it('400 on the specification or without details: a general problem', () => {
    const spec = api.interpretResponse({
      status: 400,
      headers: {},
      body: { error: 'Invalid specification_json', details: ['/quantity: must be >= 1', 'root: must have required property'] }
    });
    const missing = api.interpretResponse({ status: 400, headers: {}, body: { error: 'Missing required field: category' } });
    const json = api.interpretResponse({ status: 400, headers: {}, body: { error: 'Invalid JSON body', code: 'INVALID_JSON' } });
    const nothing = api.interpretResponse({ status: 400, headers: {}, body: undefined });

    expect([spec.general, missing.general, json.general, nothing.general]).toEqual([
      'specification', 'invalid_request', 'invalid_json', 'invalid_request'
    ]);
    expect(spec.fieldErrors).toEqual([]);
  });

  describe('429', () => {
    it('reads Retry-After in seconds, from a plain object and from Headers', () => {
      expect(api.interpretResponse({ status: 429, headers: { 'retry-after': '90' }, body: {} })).toEqual({ kind: 'rateLimited', retryAfterSeconds: 90 });
      expect(api.interpretResponse({ status: 429, headers: { 'Retry-After': '30' }, body: {} }).retryAfterSeconds).toBe(30);
      expect(api.interpretResponse({ status: 429, headers: new g.Headers({ 'Retry-After': '120' }), body: {} }).retryAfterSeconds).toBe(120);
    });

    it('falls back to the body, then to a minute; caps the wait at an hour', () => {
      expect(api.interpretResponse({ status: 429, headers: {}, body: { retry_after_seconds: 45 } }).retryAfterSeconds).toBe(45);
      expect(api.interpretResponse({ status: 429, headers: {}, body: {} }).retryAfterSeconds).toBe(60);
      expect(api.interpretResponse({ status: 429, headers: { 'retry-after': '999999' }, body: {} }).retryAfterSeconds).toBe(3600);
    });

    it('reads an HTTP date and ignores nonsense', () => {
      const now = Date.parse('2026-10-13T03:00:00Z');
      expect(api.parseRetryAfter({ 'retry-after': 'Tue, 13 Oct 2026 03:02:00 GMT' }, now)).toBe(120);
      for (const bad of ['', 'soon', '-5', '0', '1.5e3', 'NaN']) {
        expect(api.parseRetryAfter({ 'retry-after': bad }, now)).toBe(60);
      }
      expect(api.parseRetryAfter(undefined, now)).toBe(60);
    });
  });

  it('503 PRIVACY_CONSENT_NOT_CONFIGURED: not ready; another 503 is a server error', () => {
    expect(
      api.interpretResponse({ status: 503, headers: {}, body: { code: 'PRIVACY_CONSENT_NOT_CONFIGURED', error: 'x' } })
    ).toEqual({ kind: 'notReady' });
    expect(api.interpretResponse({ status: 503, headers: {}, body: {} }).kind).toBe('serverError');
  });

  it('5xx: a server error; with files the request may have been saved', () => {
    expect(api.interpretResponse({ status: 500, headers: {}, body: { error: 'Internal server error' } })).toEqual({
      kind: 'serverError',
      mayHaveBeenSaved: false
    });
    expect(api.interpretResponse({ status: 500, headers: {}, body: {} }, { hadFiles: true })).toEqual({
      kind: 'serverError',
      mayHaveBeenSaved: true
    });
    expect(api.interpretResponse({ status: 502, headers: {}, body: undefined }).kind).toBe('serverError');
  });

  it('anything else is unexpected', () => {
    expect(api.interpretResponse({ status: 404, headers: {}, body: {} })).toEqual({ kind: 'unexpected', status: 404 });
    expect(api.interpretResponse(undefined)).toEqual({ kind: 'unexpected', status: null });
  });

  it('does not repeat the text of the answer: the messages of the API stay out of the result', () => {
    const result = api.interpretResponse({
      status: 400,
      headers: {},
      body: { error: 'Invalid customer information', details: [{ field: 'customer_name', message: 'is required <script>alert(1)</script>' }] }
    });

    expect(JSON.stringify(result)).not.toMatch(/script|alert|Invalid customer/);
  });
});

describe('submitEstimate', () => {
  const request = { url: 'http://localhost:4000/api/estimates', init: { method: 'POST', headers: {}, body: '{}' } };
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: new g.Headers(headers),
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError('no body');
      }
      return body;
    }
  });

  it('sends the request with a signal and returns the result', async () => {
    const fetch = jest.fn(async () => answer(201, { receipt_id: 'BP1', created_at: 'x', message: 'm' }));

    const result = await api.submitEstimate({ fetch, request, timeoutMs: 1000 });

    expect(result).toMatchObject({ kind: 'success', receiptId: 'BP1' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, any];
    expect(url).toBe(request.url);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(g.AbortSignal);
    expect(request.init).not.toHaveProperty('signal'); // the request itself is not changed
  });

  it('turns every kind of answer into a result', async () => {
    const run = (response: unknown, context = {}) =>
      api.submitEstimate({ fetch: async () => response, request, timeoutMs: 1000, ...context });

    expect((await run(answer(400, { error: 'x', details: [{ field: 'contact', message: 'm' }] }))).kind).toBe('validation');
    expect(await run(answer(429, {}, { 'Retry-After': '75' }))).toEqual({ kind: 'rateLimited', retryAfterSeconds: 75 });
    expect(await run(answer(503, { code: 'PRIVACY_CONSENT_NOT_CONFIGURED' }))).toEqual({ kind: 'notReady' });
    expect(await run(answer(500, { error: 'x' }), { hadFiles: true })).toEqual({ kind: 'serverError', mayHaveBeenSaved: true });
    expect((await run(answer(502, undefined))).kind).toBe('serverError'); // an answer that is not JSON
  });

  it('a network error is a result, not an exception', async () => {
    const result = await api.submitEstimate({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      request,
      timeoutMs: 1000
    });

    expect(result).toEqual({ kind: 'network', mayHaveBeenSaved: true });
  });

  it('gives up after the time limit and says so', async () => {
    const fetch = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new g.DOMException('aborted', 'AbortError')));
      });

    const result = await api.submitEstimate({ fetch, request, timeoutMs: 20 });

    expect(result).toEqual({ kind: 'timeout', mayHaveBeenSaved: true });
  });

  it('stops its timer when the answer comes (nothing is left running)', async () => {
    jest.useFakeTimers();
    try {
      const pending = api.submitEstimate({ fetch: async () => answer(201, { receipt_id: 'BP2' }), request, timeoutMs: 5000 });
      await jest.advanceTimersByTimeAsync(0);
      await pending;

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the texts for the visitor', () => {
  const FORBIDDEN_TIME_WORDS = /빠른|빨리|곧|즉시|신속|최대한|바로|영업일|이내에 (연락|답변)/;
  const codes = [
    'required', 'customer_type_required', 'name_required', 'company_required', 'contact_required', 'invalid_email',
    'invalid_phone', 'too_long', 'invalid_chars', 'invalid_choice', 'consent_required', 'consent_version',
    'quantity_invalid', 'choice_required', 'sizes_required', 'description_required', 'invalid_number', 'invalid_date',
    'invalid', 'rate_limited', 'not_ready', 'server_error', 'server_error_files', 'network', 'invalid_request',
    'specification', 'unexpected'
  ];
  const fileCodes = ['type_not_allowed', 'type_unknown', 'type_mismatch', 'too_large', 'empty', 'too_many', 'total_too_large', 'duplicate', 'content_mismatch', 'invalid'];

  it('exist in Korean for every code the module produces', () => {
    for (const code of codes) {
      const text = api.messageFor(code, { max: 100, minutes: 2, name: 'a.png' });
      expect(text).toMatch(/[가-힣]/);
      expect(text).not.toMatch(/\{(name|max|minutes)\}/);
    }
    for (const code of fileCodes) {
      expect(api.messageForFile(code, 'a.png')).toMatch(/[가-힣]/);
    }
  });

  it('every code the module can produce has a text (the codes of the checks)', () => {
    const produced = new Set<string>();
    const collect = (errors: Array<{ code: string }>) => errors.forEach(e => produced.add(e.code));
    collect(api.validateCustomer({}).errors);
    collect(api.validateCustomer({ customer_type: 'x', customer_name: 'a\u0001', customer_email: 'x', customer_phone: '1' }).errors);
    collect(api.validateSpecInput('sunglasses', 'optical', { frameColor: 'x'.repeat(200), bridgeWidth: 'x', deliveryDate: 'x' }).errors);
    collect(api.validateSpecInput('shoes', 'boots', {}).errors);
    collect(api.validateSpecInput('other', null, {}).errors);
    for (const code of produced) {
      expect(api.messageFor(code, { max: 1 })).not.toBe(api.messageFor('invalid'));
    }
  });

  it('make no promise about time', () => {
    const all = [...codes.map(code => api.messageFor(code, { max: 1, minutes: 3, name: 'x' })), ...fileCodes.map(c => api.messageForFile(c, 'x'))];
    for (const text of all) {
      expect(text).not.toMatch(FORBIDDEN_TIME_WORDS);
    }
  });

  it('are plain text: no HTML in them (the page shows them with textContent)', () => {
    for (const code of codes) {
      expect(api.messageFor(code, { max: 1, minutes: 3, name: 'x' })).not.toMatch(/[<>]/);
    }
  });

  it('put a file name in as it is, without escaping: the caller shows the text with textContent', () => {
    const name = '<img src=x onerror=alert(1)>.png';

    expect(api.messageForFile('too_large', name)).toBe(`${name}: 파일당 10MB까지 첨부할 수 있어요.`);
    expect(api.messageFor('file_type_not_allowed', { name })).toContain(name);
  });

  it('say what the limits are', () => {
    expect(api.messageForFile('type_not_allowed', 'a.gif')).toContain('JPG, PNG, PDF');
    expect(api.messageForFile('too_large', 'a.png')).toContain('10MB');
    expect(api.messageFor('file_too_many')).toContain('5개');
    expect(api.messageFor('file_total_too_large')).toContain('30MB');
    expect(api.messageFor('invalid_phone')).toContain('7~15');
    expect(api.messageFor('choice_required')).toContain('잘 모르겠음');
    expect(api.UNKNOWN_LABEL).toBe('잘 모르겠음');
    expect(api.UNKNOWN).toBe('unknown');
  });

  it('turn a result into a text: the wait in minutes (at least one), the files case, the network', () => {
    expect(api.messageForResult({ kind: 'rateLimited', retryAfterSeconds: 90 })).toContain('약 2분');
    expect(api.messageForResult({ kind: 'rateLimited', retryAfterSeconds: 5 })).toContain('약 1분');
    expect(api.messageForResult({ kind: 'notReady' })).toBe(api.messageFor('not_ready'));
    expect(api.messageForResult({ kind: 'serverError', mayHaveBeenSaved: false })).toBe(api.messageFor('server_error'));
    expect(api.messageForResult({ kind: 'serverError', mayHaveBeenSaved: true })).toBe(api.messageFor('server_error_files'));
    expect(api.messageForResult({ kind: 'network' })).toBe(api.messageFor('network'));
    expect(api.messageForResult({ kind: 'timeout' })).toBe(api.messageFor('network'));
    expect(api.messageForResult({ kind: 'validation', general: 'specification' })).toBe(api.messageFor('specification'));
    expect(api.messageForResult({ kind: 'unexpected' })).toBe(api.messageFor('unexpected'));
    expect(api.messageForResult(undefined)).toBe(api.messageFor('unexpected'));
  });

  it('an unknown code gets the general text, not an empty one', () => {
    expect(api.messageFor('no-such-code')).toBe(api.messageFor('invalid'));
    expect(api.messageForFile('no-such-code', 'a.png')).toBe(api.messageFor('file_invalid', { name: 'a.png' }));
  });

  it('the answer on a created request is never turned into a text with the token or the status', () => {
    const text = JSON.stringify(
      ['rate_limited', 'server_error', 'network'].map(code => api.messageFor(code, { minutes: 1 }))
    );
    expect(text).not.toMatch(/token|status|new_receipt/);
  });
});
