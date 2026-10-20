jest.mock('../../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../../services/fileService', () => ({ uploadMultipleFilesWithMetadata: jest.fn() }));

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { createApp } from '../../app';
import { createEstimate } from '../../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../../services/fileService';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../../utils/customerMessages';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');

/* eslint-disable @typescript-eslint/no-explicit-any */
// The inquiry page of the other products runs in its own jsdom window (express and supertest do not
// run in jsdom's global); its fetch goes to the real application in this process (real validation,
// the services replaced by mocks). So the page, the request builder and the API are checked
// against each other without a browser.
const ROOT = path.join(__dirname, '..', '..', '..');
const FILES = ['config.js', 'estimate-api.js', 'estimate-customer-step.js', 'estimate-submit.js', 'other-inquiry.js'];
const HIGH = { windowMs: 3600000, max: 100000 };

let win: any;
const $ = (selector: string): any => win.document.querySelector(selector);

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};
function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new win.Event('input', { bubbles: true }));
}
function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
}

describe('the inquiry page of the other products against the real API', () => {
  let app: Express;
  const create = createEstimate as jest.Mock;
  const upload = uploadMultipleFilesWithMetadata as jest.Mock;
  const originalNodeEnv = config.nodeEnv;

  beforeEach(() => {
    app = createApp({ rateLimits: { estimateCreate: HIGH, estimateRead: HIGH } });
    create.mockReset().mockResolvedValue({
      success: true,
      receipt_id: 'BP20261015002',
      estimate_id: 'internal-uuid',
      status: 'new_receipt',
      access_token: 'c'.repeat(64),
      created_at: '2026-10-15T04:00:00.000Z'
    });
    upload.mockReset();
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    win?.close();
    win = undefined;
    config.nodeEnv = originalNodeEnv;
    jest.restoreAllMocks();
  });

  async function open(): Promise<void> {
    const html = fs.readFileSync(path.join(ROOT, 'other-inquiry.html'), 'utf8');
    win = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost:5500/' }).window;
    win.fetch = async (url: string, init: any) => {
      expect(new URL(url).origin).toBe('http://localhost:4000');
      const response = await request(app)
        .post(new URL(url).pathname)
        .set('Content-Type', init.headers['Content-Type'])
        .send(init.body);
      return { status: response.status, headers: response.headers, json: async () => response.body };
    };
    FILES.forEach(file => win.eval(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    // The window fires DOMContentLoaded and load by itself, after the scripts are in.
    if (win.document.readyState !== 'complete') {
      await new Promise(resolve => win.addEventListener('load', resolve));
    }
  }

  function fillIn(extra: { delivery?: string; special?: string } = {}): void {
    type($('#productDescription'), '맞춤형 텀블러 (로고 인쇄)');
    type($('#quantity'), '1000');
    if (extra.delivery) {
      type($('#deliveryDate'), extra.delivery);
    }
    if (extra.special) {
      type($('#additionalInfo'), extra.special);
    }
    check($('#customerTypeBusiness'));
    type($('#customerName'), 'Lee');
    type($('#customerCompany'), 'Acme');
    type($('#customerEmail'), 'buyer@example.com');
    check($('#privacyConsent'));
  }

  const send = async (): Promise<void> => {
    $('#submitBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
  };

  it('is accepted as the category other, with the specification the API checks', async () => {
    await open();
    fillIn({ delivery: '2026-12-24', special: '박스 포장은 별도' });
    await send();

    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0][0];
    expect(sent.category).toBe('other');
    expect(sent.specification_json).toEqual({
      schema_version: '1.0',
      product_description: '맞춤형 텀블러 (로고 인쇄)',
      quantity: 1000,
      delivery_date: '2026-12-24',
      special_requirements: '박스 포장은 별도'
    });
    expect(sent.customer_type).toBe('business_brand');
    expect(sent.company_name).toBe('Acme');
    expect(sent.privacy_consent_version).toBe('dev-draft');
    expect(upload).not.toHaveBeenCalled();
  });

  it('is accepted with only the required values, and with special requirements of exactly 2,000 characters', async () => {
    await open();
    fillIn();
    await send();
    expect(Object.keys(create.mock.calls[0][0].specification_json).sort()).toEqual(['product_description', 'quantity', 'schema_version']);
    win.close();

    await open();
    fillIn({ special: 'x'.repeat(2000) });
    await send();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].specification_json.special_requirements).toHaveLength(2000);
  });

  it('shows only the receipt number, the time and the fixed message of the server', async () => {
    await open();
    fillIn();
    await send();

    expect($('#successMessage').style.display).toBe('block');
    expect($('#inquiryForm').style.display).toBe('none');
    expect($('#receiptId').textContent).toBe('BP20261015002');
    expect($('#receiptMessage').textContent).toBe(CUSTOMER_GUIDANCE_MESSAGE);
    const shown = win.document.documentElement.outerHTML;
    expect(shown).not.toContain('c'.repeat(64));
    expect(shown).not.toContain('new_receipt');
    expect(shown).not.toContain('internal-uuid');
  });

  it('production without an approved consent text: says it is not ready and keeps the input', async () => {
    config.nodeEnv = 'production';
    await open();
    fillIn();
    await send();

    expect(create).not.toHaveBeenCalled();
    expect($('#successMessage').style.display).toBe('none');
    expect($('#submitError').textContent).toContain('준비하고 있어요');
    expect($('#productDescription').value).toBe('맞춤형 텀블러 (로고 인쇄)');
    expect($('#customerName').value).toBe('Lee');
  });

  it('too many requests: tells the wait in minutes and keeps the form', async () => {
    app = createApp({ rateLimits: { estimateCreate: { windowMs: 3600000, max: 1 }, estimateRead: HIGH } });
    await open();
    fillIn();
    await send();
    expect($('#successMessage').style.display).toBe('block');
    win.close();

    await open();
    fillIn();
    await send();
    expect($('#successMessage').style.display).toBe('none');
    expect($('#submitError').textContent).toMatch(/\d+분 뒤에 다시 시도/);
    expect(create).toHaveBeenCalledTimes(1);
    expect($('#submitBtn').disabled).toBe(false);
  });

  it('a failure of the API: the page shows its own message, not the text of the error', async () => {
    create.mockRejectedValue(new Error('connection to db-host-secret failed'));
    await open();
    fillIn();
    await send();

    expect($('#submitError').hidden).toBe(false);
    expect(win.document.documentElement.outerHTML).not.toContain('db-host-secret');
    expect($('#submitBtn').disabled).toBe(false);
    expect($('#customerName').disabled).toBe(false);
  });
});
