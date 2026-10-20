/**
 * @jest-environment jsdom
 */
import { API_SCRIPTS, runScript } from './domHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;
const $ = (selector: string): any => g.document.querySelector(selector);

// The two parts that the estimate pages and the inquiry of the other products share, tested without
// any page: a small form of their own.
const FORM = `
  <form id="f">
    <div class="form-group"><label for="a">A</label><input id="a"></div>
    <div class="form-group"><label for="b">B</label><input id="b"></div>
    <input id="off" disabled>
    <button id="go" type="button">Send</button>
    <div id="ok" style="display:none"><span id="receiptId"></span><p id="receiptTimeRow" hidden><span id="receiptTime"></span></p><p id="receiptMessage" hidden></p></div>
  </form>`;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

beforeAll(() => {
  API_SCRIPTS.forEach(runScript);
  runScript('estimate-customer-step.js');
  runScript('estimate-submit.js');
});

beforeEach(() => {
  g.document.body.innerHTML = FORM;
});

describe('estimate-submit.js: createProductErrors', () => {
  function make(): any {
    return g.BridgePathSubmit.createProductErrors({
      controlsFor: (field: string) => (field === 'quantity' ? [$('#a')] : field === 'productDescription' ? [$('#b')] : []),
      summaryParent: $('#f'),
      summaryBefore: $('#f').firstChild,
      listenOn: $('#f')
    });
  }

  it('puts a summary first in the form, hidden until there is an error', () => {
    make();
    expect($('#f').firstElementChild.id).toBe('productErrorSummary');
    expect($('#productErrorSummary').hidden).toBe(true);
    expect($('#productErrorSummary').getAttribute('role')).toBe('alert');
  });

  it('shows each error at its control, counts them and focuses the first in the order of the page', () => {
    const errors = make();
    errors.show([{ field: 'productDescription', code: 'description_required' }, { field: 'quantity', code: 'quantity_invalid' }]);
    expect($('#productError-quantity').textContent).toBe(g.BridgePathEstimate.messageFor('quantity_invalid'));
    expect($('#a').getAttribute('aria-describedby')).toBe('productError-quantity');
    expect($('#a').getAttribute('aria-invalid')).toBe('true');
    expect($('#a').closest('.form-group').contains($('#productError-quantity'))).toBe(true);
    expect($('#productErrorSummary').textContent).toBe('확인이 필요한 항목이 2개 있어요.');
    expect(g.document.activeElement).toBe($('#a'));
  });

  it('shows the same field once and ignores a field without a control, but still tells', () => {
    const errors = make();
    errors.show([{ field: 'quantity', code: 'quantity_invalid' }, { field: 'quantity', code: 'invalid' }, { field: 'unknown', code: 'invalid' }]);
    expect(g.document.querySelectorAll('.field-error').length).toBe(1);
    expect($('#productErrorSummary').textContent).toBe('확인이 필요한 항목이 1개 있어요.');
    errors.show([{ field: 'unknown', code: 'invalid' }]);
    expect($('#productErrorSummary').hidden).toBe(false);
    expect(g.document.activeElement).toBe($('#productErrorSummary'));
  });

  it('takes an error away when its control is changed, and the summary follows', () => {
    const errors = make();
    errors.show([{ field: 'productDescription', code: 'description_required' }, { field: 'quantity', code: 'quantity_invalid' }]);
    $('#a').dispatchEvent(new g.Event('input', { bubbles: true }));
    expect($('#productError-quantity')).toBeNull();
    expect($('#a').getAttribute('aria-invalid')).toBeNull();
    expect($('#productErrorSummary').textContent).toBe('확인이 필요한 항목이 1개 있어요.');
    $('#b').dispatchEvent(new g.Event('change', { bubbles: true }));
    expect($('#productErrorSummary').hidden).toBe(true);
  });

  it('clear() removes everything', () => {
    const errors = make();
    errors.show([{ field: 'quantity', code: 'quantity_invalid' }]);
    errors.clear();
    expect($$count('.field-error')).toBe(0);
    expect($('#a').getAttribute('aria-invalid')).toBeNull();
    expect($('#productErrorSummary').hidden).toBe(true);
  });

  it('puts a text that looks like markup in as text', () => {
    const errors = make();
    errors.show([{ field: 'quantity', code: 'too_long', max: '<img src=x onerror=alert(1)>' }]);
    expect($('#f img')).toBeNull();
  });
});

function $$count(selector: string): number {
  return g.document.querySelectorAll(selector).length;
}

describe('estimate-submit.js: createSubmitter', () => {
  const CUSTOMER = { valid: true, value: { customer_type: 'individual_startup', customer_name: 'Kim', customer_email: 'a@b.co' } };

  function make(overrides: Record<string, unknown> = {}): { submitter: any; customerStep: any; productErrors: any } {
    const customerStep = {
      validate: jest.fn().mockReturnValue(CUSTOMER),
      showServerErrors: jest.fn(),
      reset: jest.fn()
    };
    const productErrors = { show: jest.fn(), clear: jest.fn() };
    const submitter = g.BridgePathSubmit.createSubmitter({
      page: 'other',
      getSubtype: () => null,
      collectValues: () => ({ productDescription: 'tumbler', quantity: '10', deliveryDate: '', additionalInfo: '' }),
      customerStep,
      productErrors,
      submitButton: $('#go'),
      successBox: $('#ok'),
      errorParent: $('#f'),
      errorBefore: $('#go'),
      lockElements: () => Array.from(g.document.querySelectorAll('#f input, #f button')),
      hideOnSuccess: [$('#f')],
      ...overrides
    });
    return { submitter, customerStep, productErrors };
  }

  beforeEach(() => {
    g.fetch = jest.fn().mockResolvedValue({
      status: 201,
      headers: { get: () => null },
      json: async () => ({ receipt_id: 'BP-9', created_at: '2026-10-15T00:00:00Z', message: 'M', access_token: 'TOKEN', status: 'new_receipt' })
    });
  });

  afterEach(() => {
    delete g.fetch;
  });

  it('puts the error of the request just before the given node', () => {
    make();
    expect($('#submitError').nextElementSibling).toBe($('#go'));
    expect($('#submitError').hidden).toBe(true);
  });

  it('sends the product input as JSON of the category other, with the customer and the consent', async () => {
    const { submitter } = make();
    await submitter.submit();
    expect(g.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(g.fetch.mock.calls[0][1].body);
    expect(body.category).toBe('other');
    expect(body.specification_json.product_description).toBe('tumbler');
    expect(body.privacy_consent).toBe(true);
    expect(body.customer_name).toBe('Kim');
  });

  it('shows the product errors and sends nothing when the product input is wrong, and validates the customer without focus', async () => {
    const onProductInvalid = jest.fn();
    const { submitter, productErrors, customerStep } = make({ collectValues: () => ({ productDescription: '', quantity: '' }), onProductInvalid });
    await submitter.submit();
    expect(g.fetch).not.toHaveBeenCalled();
    expect(onProductInvalid).toHaveBeenCalledTimes(1);
    expect(productErrors.show).toHaveBeenCalledTimes(1);
    expect(customerStep.validate).toHaveBeenCalledWith({ focus: false });
  });

  it('sends nothing when the customer is wrong, and gives the focus to the customer when the product is right', async () => {
    const { submitter, customerStep } = make();
    customerStep.validate.mockReturnValue({ valid: false, errors: [] });
    await submitter.submit();
    expect(g.fetch).not.toHaveBeenCalled();
    expect(customerStep.validate).toHaveBeenCalledWith({ focus: true });
  });

  it('locks only what was enabled, and gives back only that after a failure', async () => {
    g.fetch.mockResolvedValue({ status: 500, headers: { get: () => null }, json: async () => ({}) });
    let during: boolean[] = [];
    g.fetch.mockImplementation(async () => {
      during = [$('#a').disabled, $('#off').disabled, $('#go').disabled];
      return { status: 500, headers: { get: () => null }, json: async () => ({}) };
    });
    const { submitter } = make();
    await submitter.submit();
    expect(during).toEqual([true, true, true]);
    expect($('#a').disabled).toBe(false);
    expect($('#off').disabled).toBe(true); // it was disabled before, so it is still
    expect($('#go').disabled).toBe(false);
    expect($('#go').textContent).toBe('Send');
  });

  it('stays locked and refuses a second request after a success, and shows only the three values', async () => {
    const { submitter, customerStep } = make();
    await submitter.submit();
    await flush();
    expect($('#receiptId').textContent).toBe('BP-9');
    expect($('#receiptMessage').textContent).toBe('M');
    expect($('#ok').style.display).toBe('block');
    expect($('#f').style.display).toBe('none');
    expect(customerStep.reset).toHaveBeenCalledTimes(1);
    expect(g.document.documentElement.outerHTML).not.toContain('TOKEN');
    expect(g.document.documentElement.outerHTML).not.toContain('new_receipt');
    await submitter.submit();
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it('a thrown error while sending becomes the general message and gives the form back', async () => {
    g.fetch = undefined;
    const { submitter } = make();
    await submitter.submit();
    expect($('#submitError').hidden).toBe(false);
    expect($('#submitError').textContent).not.toBe('');
    expect($('#go').disabled).toBe(false);
  });

  it('formatTime shows a time in Seoul and an unreadable one as it is', () => {
    expect(g.BridgePathSubmit.formatTime('2026-10-15T15:30:00.000Z')).toContain('2026');
    expect(g.BridgePathSubmit.formatTime('not a time')).toBe('not a time');
  });
});
