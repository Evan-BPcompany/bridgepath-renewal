jest.mock('../../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../../services/fileService', () => ({ uploadMultipleFilesWithMetadata: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { createApp } from '../../app';
import { createEstimate } from '../../services/estimateService';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../../utils/customerMessages';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');

/* eslint-disable @typescript-eslint/no-explicit-any */
// This file runs in the node environment (express and supertest do not run in jsdom's global); the
// page gets its own jsdom window, with the scripts of the root folder evaluated in it as a browser would.
const ROOT = path.join(__dirname, '..', '..', '..');
let win: any;
const $ = (selector: string): any => win.document.querySelector(selector);
const $$ = (selector: string): any[] => Array.from(win.document.querySelectorAll(selector));

const HIGH = { windowMs: 3600000, max: 100000 };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

function type(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new win.Event('input', { bubbles: true }));
}
function choose(element: any, value: string): void {
  element.value = value;
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function check(element: any, checked = true): void {
  element.checked = checked;
  element.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function click(element: any): void {
  element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const PAGE_FILES = (page: string): string[] => [
  'config.js',
  'estimate-api.js',
  'estimate-common.js',
  'estimate-customer-step.js',
  'estimate-flow.js',
  `${page}-estimate.js`
];

const PAGES = [
  { page: 'sunglasses', card: 'sports', category: 'eyewear', fill: () => { choose($('#lensType'), 'mirror'); choose($('#frameMaterial'), 'unknown'); type($('#quantity'), '300'); } },
  { page: 'shoes', card: 'other', category: 'shoes', fill: () => { choose($('#material'), 'unknown'); check($('#size240')); type($('#quantity'), '80'); } },
  { page: 'golf', card: 'covers', category: 'golf_products', fill: () => { choose($('#material'), 'nylon'); type($('#productColor'), 'black'); type($('#quantity'), '50'); } }
];

describe('the estimate pages against the real API', () => {
  let app: Express;
  const create = createEstimate as jest.Mock;
  const originalNodeEnv = config.nodeEnv;

  beforeEach(() => {
    app = createApp({ rateLimits: { estimateCreate: HIGH, estimateRead: HIGH } });
    create.mockReset().mockResolvedValue({
      success: true,
      receipt_id: 'BP20261015001',
      estimate_id: 'internal-uuid',
      status: 'new_receipt',
      access_token: 'b'.repeat(64),
      created_at: '2026-10-15T03:00:00.000Z'
    });
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

  function openPage(page: string): void {
    const html = fs.readFileSync(path.join(ROOT, `${page}-estimate.html`), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost:5500/' });
    win = dom.window;
    win.scrollTo = () => undefined;
    // The fetch of the page: the request goes to the application in this process, nowhere else.
    win.fetch = async (url: string, init: any) => {
      expect(new URL(url).origin).toBe('http://localhost:4000');
      const response = await request(app)
        .post(new URL(url).pathname)
        .set('Content-Type', init.headers['Content-Type'])
        .send(init.body);
      return { status: response.status, headers: response.headers, json: async () => response.body };
    };
    PAGE_FILES(page).forEach(file => {
      win.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    });
  }

  // The window fires DOMContentLoaded and load by itself, after the scripts are in.
  async function loaded(): Promise<void> {
    if (win.document.readyState !== 'complete') {
      await new Promise(resolve => win.addEventListener('load', resolve));
    }
  }

  async function openAtStep3(entry: (typeof PAGES)[number]): Promise<void> {
    openPage(entry.page);
    await loaded();
    click($$('.category-card').find(card => card.getAttribute('data-category') === entry.card));
    click($('#nextBtn1'));
    entry.fill();
    click($('#nextBtn2'));
    check($('#customerTypeIndividual'));
    type($('#customerName'), 'Kim');
    type($('#customerPhone'), '010-1234-5678');
    check($('#privacyConsent'));
  }

  it.each(PAGES)('$page: the API accepts what the page sends and the page shows only the receipt, the time and the fixed message', async entry => {
    await openAtStep3(entry);
    click($('#submitBtn'));
    await flush();

    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0][0];
    expect(sent.category).toBe(entry.category);
    expect(sent.specification_json.schema_version).toBe('1.0');
    expect(sent.customer_type).toBe('individual_startup');
    expect(sent.privacy_consent_version).toBe('dev-draft');

    expect($('#successMessage').style.display).toBe('block');
    expect($('#receiptId').textContent).toBe('BP20261015001');
    expect($('#receiptMessage').textContent).toBe(CUSTOMER_GUIDANCE_MESSAGE);
    const shown = win.document.documentElement.outerHTML;
    expect(shown).not.toContain('b'.repeat(64));
    expect(shown).not.toContain('new_receipt');
    expect(shown).not.toContain('internal-uuid');
  });

  it('shoes "기타" is stored as the category shoes with the type other', async () => {
    await openAtStep3(PAGES[1]);
    click($('#submitBtn'));
    await flush();
    const sent = create.mock.calls[0][0];
    expect(sent.category).toBe('shoes');
    expect(sent.specification_json.shoe_type).toBe('other');
  });

  it('production without an approved consent text: the page says it is not ready and keeps the input', async () => {
    config.nodeEnv = 'production';
    await openAtStep3(PAGES[0]);
    click($('#submitBtn'));
    await flush();
    expect(create).not.toHaveBeenCalled();
    expect($('#successMessage').style.display).toBe('none');
    expect($('#submitError').textContent).toContain('준비하고 있어요');
    expect($('#customerName').value).toBe('Kim');
  });

  it('too many requests: the page tells the wait in minutes', async () => {
    app = createApp({ rateLimits: { estimateCreate: { windowMs: 3600000, max: 1 }, estimateRead: HIGH } });
    await openAtStep3(PAGES[2]);
    click($('#submitBtn'));
    await flush();
    expect($('#successMessage').style.display).toBe('block');
    win.close();
    await openAtStep3(PAGES[2]);
    click($('#submitBtn'));
    await flush();
    expect($('#successMessage').style.display).toBe('none');
    expect($('#submitError').textContent).toMatch(/\d+분 뒤에 다시 시도/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a 500 of the API: the page shows its own message, not the text of the error', async () => {
    create.mockRejectedValue(new Error('connection to db-host-secret failed'));
    await openAtStep3(PAGES[0]);
    click($('#submitBtn'));
    await flush();
    expect($('#submitError').hidden).toBe(false);
    expect(win.document.documentElement.outerHTML).not.toContain('db-host-secret');
    expect($('#submitBtn').disabled).toBe(false);
  });
});
