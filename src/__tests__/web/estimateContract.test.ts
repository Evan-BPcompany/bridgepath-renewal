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
import { CATEGORY_MAPPING } from '../../utils/specification';
import { createEstimate } from '../../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../../services/fileService';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../../utils/customerMessages';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../../estimate-api.js');
const g = globalThis as any;

// The requests the front end builds are sent to the real application (real validation, services
// replaced by mocks) and the answers are read with the front end's own code: the two sides are
// checked against each other without a browser.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const HIGH = { windowMs: 3600000, max: 100000 };

const VALUES: Record<string, Record<string, unknown>> = {
  sunglasses: { frameMaterial: 'unknown', lensType: 'polarized', quantity: '1000', frameColor: '검정', bridgeWidth: '20' },
  shoes: { material: 'unknown', sizes: ['240', '250', '270'], quantity: '500', color: '흰색', additionalInfo: '특수 밑창' },
  golf: { material: 'nylon', quantity: '300', color: '검정', size: 'One size', design: '로고 인쇄' },
  other: { productDescription: '맞춤형 텀블러', quantity: '1000' }
};
const INDIVIDUAL = {
  customer_type: 'individual_startup',
  customer_name: 'Kim',
  customer_email: 'buyer@example.com',
  privacy_consent: true
};
const BUSINESS = {
  customer_type: 'business_brand',
  customer_name: 'Lee',
  company_name: 'Acme',
  customer_phone: '010-1234-5678',
  privacy_consent: true
};

describe('the front end against the real API', () => {
  let app: Express;
  const create = createEstimate as jest.Mock;
  const upload = uploadMultipleFilesWithMetadata as jest.Mock;
  const originalNodeEnv = config.nodeEnv;

  const build = (page: string, subtype: string | null, customer: Record<string, unknown> = INDIVIDUAL, files: unknown[] = []) => {
    const spec = api.buildSpecification(page, subtype, VALUES[page]);
    expect(spec.ok).toBe(true);
    const checked = api.validateCustomer(customer);
    expect(checked.valid).toBe(true);
    return api.buildRequest({
      apiBase: 'http://localhost:4000',
      page,
      subtype,
      spec: spec.spec,
      customer: checked.value,
      consentVersion: 'dev-draft',
      files
    });
  };

  // Sends what the browser would send: the body bytes and the Content-Type with its boundary.
  const send = async (target: Express, built: { url: string; init: any }) => {
    const pathname = new URL(built.url).pathname;
    const wire = new g.Request(built.url, { method: 'POST', headers: built.init.headers, body: built.init.body });
    const contentType = wire.headers.get('content-type');
    const body = Buffer.from(await wire.arrayBuffer());
    // superagent would run a Buffer through its JSON serializer when the type is JSON, so a JSON
    // body goes as the text it is; a form goes as the raw bytes.
    const payload = String(contentType).startsWith('application/json') ? body.toString('utf8') : body;
    return request(target).post(pathname).set('Content-Type', contentType).send(payload);
  };

  const read = (response: request.Response, hadFiles = false) =>
    api.interpretResponse({ status: response.status, headers: response.headers, body: response.body }, { hadFiles });

  const sentToService = () => create.mock.calls[create.mock.calls.length - 1][0];

  beforeEach(() => {
    app = createApp({ rateLimits: { estimateCreate: HIGH, estimateRead: HIGH } });
    create.mockReset().mockResolvedValue({
      success: true,
      receipt_id: 'BP20261013001',
      estimate_id: 'internal-uuid',
      status: 'new_receipt',
      access_token: 'a'.repeat(64),
      created_at: '2026-10-13T03:00:00.000Z'
    });
    upload.mockReset().mockImplementation(async (_id: string, files: Array<{ originalFilename: string; buffer: Buffer }>) =>
      files.map((file, index) => ({ id: `f${index}`, filename: file.originalFilename, fileSize: file.buffer.length, status: 'quarantine' }))
    );
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    config.nodeEnv = originalNodeEnv;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    delete g.BridgePathEstimate;
  });

  describe('every page and kind of product', () => {
    const cases: Array<[string, string | null, string]> = [];
    for (const page of Object.keys(api.PAGES)) {
      const subtypes: string[] = api.PAGES[page].subtypes.length > 0 ? [...api.PAGES[page].subtypes] : [];
      if (subtypes.length === 0) {
        cases.push([page, null, api.PAGES[page].category]);
      }
      for (const subtype of subtypes) {
        cases.push([page, subtype, api.PAGES[page].category]);
      }
    }

    it('covers the 4 pages and 17 kinds of product (and the page of other products)', () => {
      expect(cases.filter(([page]) => page !== 'other')).toHaveLength(17);
      expect(cases).toHaveLength(18);
    });

    it.each(cases)('%s / %s is accepted as the category %s, with the specification the API checks', async (page, subtype, category) => {
      const response = await send(app, build(page, subtype));

      expect(response.status).toBe(201);
      expect(sentToService().category).toBe(category);
      expect(sentToService().specification_json.schema_version).toBe('1.0');
      expect(sentToService().specification_json.quantity).toEqual(expect.any(Number));
      const typeField = api.PAGES[page].typeField;
      if (typeField) {
        expect(sentToService().specification_json[typeField]).toBe(subtype);
      }
    });

    it('every kind of product is one the API knows, mapped to the category the page sends', () => {
      for (const [page, subtype, category] of cases) {
        // "other" on the shoes page is a kind of shoe; it is not the API's category "other".
        if (subtype !== null && !(page === 'shoes' && subtype === 'other')) {
          expect(CATEGORY_MAPPING[subtype]).toBe(category);
        }
      }
      for (const page of Object.keys(api.PAGES)) {
        expect(Object.values(CATEGORY_MAPPING)).toContain(api.PAGES[page].category);
      }
    });
  });

  describe('the customer', () => {
    it('an individual with an e-mail: the fields arrive as the API wants them', async () => {
      const response = await send(app, build('golf', 'bags', INDIVIDUAL));

      expect(response.status).toBe(201);
      expect(sentToService()).toMatchObject({
        customer_type: 'individual_startup',
        customer_name: 'Kim',
        customer_email: 'buyer@example.com',
        privacy_consent_version: 'dev-draft'
      });
      expect(sentToService().company_name).toBeUndefined();
    });

    it('a business with a phone number and a company name', async () => {
      const response = await send(app, build('shoes', 'boots', BUSINESS));

      expect(response.status).toBe(201);
      expect(sentToService()).toMatchObject({
        customer_type: 'business_brand',
        company_name: 'Acme',
        customer_phone: '010-1234-5678'
      });
    });

    it('the checks of the front end and of the API agree on what is wrong', async () => {
      const wrong = [
        { ...INDIVIDUAL, customer_name: '' },
        { ...INDIVIDUAL, customer_email: undefined },
        { ...BUSINESS, company_name: '' },
        { ...INDIVIDUAL, customer_type: 'x' },
        { ...INDIVIDUAL, customer_email: 'nope' },
        { ...BUSINESS, customer_phone: '123' }
      ];
      for (const customer of wrong) {
        expect(api.validateCustomer(customer).valid).toBe(false);
        // Past the front end's check, as a forged request, the API refuses it too.
        const spec = api.buildSpecification('golf', 'bags', VALUES.golf).spec;
        const response = await request(app).post('/api/estimates').send({
          category: 'golf_products',
          specification_json: spec,
          privacy_consent_version: 'dev-draft',
          ...customer
        });
        expect(response.status).toBe(400);
      }
    });
  });

  describe('JSON and multipart mean the same', () => {
    it('a JSON request is read with the consent as the boolean true', async () => {
      const built = build('sunglasses', 'optical');
      expect(typeof built.init.body).toBe('string');

      const response = await send(app, built);

      expect(response.status).toBe(201);
      expect(Array.isArray(sentToService().files)).toBe(false);
      expect(upload).not.toHaveBeenCalled();
    });

    it('a request with files is a form: the consent is the text "true", the files reach the upload', async () => {
      const files = [
        new g.File([PNG], 'logo.png', { type: 'image/png' }),
        new g.File([JPG], 'photo.jpg', { type: 'image/jpeg' }),
        new g.File([PDF], 'spec.pdf', { type: 'application/pdf' })
      ];
      const built = build('sunglasses', 'optical', INDIVIDUAL, files);
      expect(built.init.body).toBeInstanceOf(g.FormData);

      const response = await send(app, built);
      const result = read(response, true);

      expect(response.status).toBe(201);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(upload.mock.calls[0][1].map((f: { originalFilename: string }) => f.originalFilename)).toEqual(['logo.png', 'photo.jpg', 'spec.pdf']);
      expect(sentToService().category).toBe('eyewear');
      expect(result.files.map((f: { name: string }) => f.name)).toEqual(['logo.png', 'photo.jpg', 'spec.pdf']);
    });

    it('five files of 10 MB-class names pass the front end limits and the real upload checks', async () => {
      const names = ['1.png', '2.png', '3.png', '4.png', '5.png'];
      const files = names.map(name => new g.File([PNG], name, { type: 'image/png' }));
      expect(api.validateFiles([], files.map((f: any) => ({ name: f.name, size: f.size, type: f.type }))).rejected).toEqual([]);

      const response = await send(app, build('other', null, INDIVIDUAL, files));

      expect(response.status).toBe(201);
      expect(upload.mock.calls[0][1]).toHaveLength(5);
    });
  });

  describe('what comes back', () => {
    it('201: the receipt number, the time, the fixed message; never the token or the internal status', async () => {
      const response = await send(app, build('golf', 'covers'));
      const result = read(response);

      expect(result).toEqual({
        kind: 'success',
        receiptId: 'BP20261013001',
        createdAt: '2026-10-13T03:00:00.000Z',
        message: CUSTOMER_GUIDANCE_MESSAGE,
        files: []
      });
      expect(JSON.stringify(result)).not.toMatch(/access_token|aaaaaaaa|new_receipt|status|internal-uuid/);
    });

    it('the files of the answer are shown by name; the scan state of a file does not reach the page', async () => {
      const files = [new g.File([PNG], 'logo.png', { type: 'image/png' })];

      const result = read(await send(app, build('shoes', 'heels', INDIVIDUAL, files)), true);

      expect(result.files).toEqual([{ name: 'logo.png', size: PNG.length }]);
      expect(JSON.stringify(result)).not.toContain('quarantine');
    });

    it('400 on the customer: each field has a code and a Korean text', async () => {
      const spec = api.buildSpecification('golf', 'bags', VALUES.golf).spec;
      const response = await request(app).post('/api/estimates').send({
        category: 'golf_products',
        specification_json: spec,
        customer_type: 'business_brand',
        customer_name: 'Lee',
        customer_email: 'x@y.co',
        privacy_consent: false,
        privacy_consent_version: 'dev-draft'
      });

      const result = read(response);

      expect(result.kind).toBe('validation');
      expect(result.fieldErrors).toEqual(
        expect.arrayContaining([
          { field: 'company_name', code: 'company_required' },
          { field: 'privacy_consent', code: 'consent_required' }
        ])
      );
      for (const error of result.fieldErrors) {
        expect(api.messageFor(error.code)).toMatch(/[가-힣]/);
      }
    });

    it('400 on the contact only', async () => {
      const spec = api.buildSpecification('other', null, VALUES.other).spec;
      const response = await request(app).post('/api/estimates').send({
        category: 'other',
        specification_json: spec,
        customer_type: 'individual_startup',
        customer_name: 'Kim',
        privacy_consent: true,
        privacy_consent_version: 'dev-draft'
      });

      expect(read(response).fieldErrors).toEqual([{ field: 'contact', code: 'contact_required' }]);
    });

    it('400 on a file whose content is not what its name says: shown file by file', async () => {
      const liar = new g.File([Buffer.from('this is not a png at all')], 'fake.png', { type: 'image/png' });

      const response = await send(app, build('shoes', 'sandals', INDIVIDUAL, [liar]));
      const result = read(response, true);

      expect(response.status).toBe(400);
      expect(result.fileErrors).toEqual([{ name: 'fake.png', codes: ['content_mismatch'] }]);
      expect(api.messageForFile('content_mismatch', 'fake.png')).toContain('fake.png');
      expect(upload).not.toHaveBeenCalled();
    });

    it('400 on a specification the API refuses (forged, past the front end)', async () => {
      const response = await request(app).post('/api/estimates').send({
        category: 'eyewear',
        specification_json: { schema_version: '1.0', quantity: 0 },
        ...api.validateCustomer(INDIVIDUAL).value,
        privacy_consent: true,
        privacy_consent_version: 'dev-draft'
      });

      const result = read(response);

      expect(result.kind).toBe('validation');
      expect(result.general).toBe('specification');
      expect(api.messageForResult(result)).toBe(api.messageFor('specification'));
    });

    it('429: the wait is read from Retry-After, which the browser is allowed to read', async () => {
      const limited = createApp({ rateLimits: { estimateCreate: { windowMs: 3600000, max: 1 }, estimateRead: HIGH } });
      await send(limited, build('golf', 'bags'));

      const response = await send(limited, build('golf', 'bags'));
      const result = read(response);

      expect(response.status).toBe(429);
      expect(result.kind).toBe('rateLimited');
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(3600);
      expect(api.messageForResult(result)).toMatch(/약 \d+분 뒤/);
      // A browser on another origin may read the header only if the API exposes it.
      const withOrigin = await request(limited)
        .post('/api/estimates')
        .set('Origin', 'http://localhost:5500')
        .send({});
      expect(String(withOrigin.headers['access-control-expose-headers']).toLowerCase()).toContain('retry-after');
    });

    it('503: production without an approved consent version is "not ready"', async () => {
      config.nodeEnv = 'production';

      const response = await send(app, build('golf', 'bags'));

      expect(response.status).toBe(503);
      expect(read(response)).toEqual({ kind: 'notReady' });
      expect(create).not.toHaveBeenCalled();
    });

    it('500 from the service: a server error, and with files it says the request may be saved', async () => {
      create.mockRejectedValue(new Error('database down'));

      const plain = read(await send(app, build('golf', 'bags')));
      const withFiles = read(
        await send(app, build('golf', 'bags', INDIVIDUAL, [new g.File([PNG], 'a.png', { type: 'image/png' })])),
        true
      );

      expect(plain).toEqual({ kind: 'serverError', mayHaveBeenSaved: false });
      expect(withFiles).toEqual({ kind: 'serverError', mayHaveBeenSaved: true });
      expect(api.messageForResult(withFiles)).toBe(api.messageFor('server_error_files'));
    });
  });

  describe('the limits of the front end are stricter than the API, so the API never has to refuse a file', () => {
    it('the front end allows 5 files of at most 10 MB, 30 MB together, the API allows more', () => {
      const { FILE_VALIDATION } = require('../../utils/fileValidation');

      expect(api.FILE_POLICY.maxFiles).toBeLessThanOrEqual(FILE_VALIDATION.MAX_FILES_PER_ESTIMATE);
      expect(api.FILE_POLICY.maxFileBytes).toBeLessThanOrEqual(FILE_VALIDATION.MAX_FILE_SIZE);
      for (const type of Object.values(api.FILE_POLICY.types)) {
        expect(FILE_VALIDATION.ALLOWED_MIME_TYPES).toContain(type);
      }
    });

    it('WEBP and GIF are refused by the front end (the API takes no WEBP, and GIF is not in the PRD)', () => {
      const result = api.validateFiles([], [
        { name: 'a.webp', size: 10, type: 'image/webp' },
        { name: 'b.gif', size: 10, type: 'image/gif' }
      ]);

      expect(result.rejected.map((r: { code: string }) => r.code)).toEqual(['type_not_allowed', 'type_not_allowed']);
    });
  });

  describe('known limits of the API today (they must be revisited when the API is changed)', () => {
    // B2: a violation of the upload limits is answered with 500, not 400, so the front end checks
    // the files itself before it sends anything.
    it('a file type the upload does not accept is answered with 500 (backend follow-up B2)', async () => {
      const webp = new g.File([Buffer.from('RIFFxxxxWEBP')], 'photo.webp', { type: 'image/webp' });

      const response = await send(app, build('golf', 'bags', INDIVIDUAL, [webp]));

      expect(response.status).toBe(500);
      expect(read(response, true)).toEqual({ kind: 'serverError', mayHaveBeenSaved: true });
    });

    it('more than 10 files are answered with 500 (backend follow-up B2)', async () => {
      const files = Array.from({ length: 11 }, (_, i) => new g.File([PNG], `f${i}.png`, { type: 'image/png' }));

      const response = await send(app, build('golf', 'bags', INDIVIDUAL, files));

      expect(response.status).toBe(500);
    });
  });
});
