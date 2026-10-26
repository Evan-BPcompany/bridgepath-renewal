jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({ storeFiles: jest.fn(), discardStoredFiles: jest.fn() }));

import request from 'supertest';
import type { Express } from 'express';
import logger from '../utils/logger';
import { createApp } from '../app';
import { PROFILE, withMultipartProfile } from './helpers/customerFixtures';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { storeFiles } from '../services/fileService';

// PRD FR-4.9.3: customers never get the internal status. Whatever the services return, the
// customer answers are built field by field and carry the fixed guidance instead.
const SPEC = { schema_version: '1.0', shoe_type: 'Running', material: 'Mesh', size_range: '240-250', quantity: 600 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const INTERNAL_STATUS =
  /new_receipt|under_review|info_requested|factory_checking|quoted|customer_review|negotiating|accepted|on_hold|completed|cancelled|rejected|archived/;

describe('the customer never sees the internal status', () => {
  let app: Express;
  const create = createEstimate as jest.Mock;
  const lookup = getEstimateByReceiptId as jest.Mock;
  const upload = storeFiles as jest.Mock;

  beforeEach(() => {
    app = createApp({ rateLimits: { estimateCreate: { windowMs: 3600000, max: 100000 } } });
    // The mocked services return a status on purpose: the routes must not pass it on.
    create.mockReset().mockResolvedValue({
      success: true,
      receipt_id: 'BP20261013001',
      estimate_id: 'internal',
      status: 'new_receipt',
      access_token: 'a'.repeat(64),
      created_at: '2026-10-13T03:00:00.000Z'
    });
    lookup.mockReset().mockResolvedValue({
      receipt_id: 'BP20261013001',
      category: 'shoes',
      status: 'under_review',
      specification_json: SPEC,
      created_at: '2026-10-13T03:00:00.000Z',
      updated_at: '2026-10-13T03:00:00.000Z',
      internal_note: 'must not leak'
    });
    upload.mockReset().mockResolvedValue([
      { id: 'f1', filename: 'logo.png', fileSize: 12, status: 'quarantine' }
    ]);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const json = () =>
    request(app)
      .post('/api/estimates')
      .send({ ...PROFILE, category: 'shoes', specification_json: SPEC, customer_email: 'buyer@example.com' });

  it('POST (JSON): no status, the fixed message instead', async () => {
    const res = await json();

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['access_token', 'created_at', 'message', 'receipt_id', 'success']);
    expect(res.body.message).toBe(CUSTOMER_GUIDANCE_MESSAGE);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNAL_STATUS);
  });

  it('POST (multipart with a file): no estimate status either; the files list keeps the file status only', async () => {
    const res = await withMultipartProfile(
      request(app)
        .post('/api/estimates')
        .field('category', 'shoes')
        .field('specification_json', JSON.stringify(SPEC))
        .field('customer_email', 'buyer@example.com')
    ).attach('files', PNG, { filename: 'logo.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['access_token', 'created_at', 'files', 'message', 'receipt_id', 'success']);
    expect(res.body.message).toBe(CUSTOMER_GUIDANCE_MESSAGE);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNAL_STATUS);
    // The scan state of a file is not the status of the request.
    expect(res.body.files).toEqual([{ id: 'f1', filename: 'logo.png', size: 12, status: 'quarantine' }]);
  });

  it('GET: no status and nothing the service adds; the fixed message instead', async () => {
    const res = await request(app).get('/api/estimates/BP20261013001').query({ token: 'a'.repeat(64) });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'category',
      'created_at',
      'message',
      'receipt_id',
      'specification_json',
      'updated_at'
    ]);
    expect(res.body.message).toBe(CUSTOMER_GUIDANCE_MESSAGE);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNAL_STATUS);
    expect(JSON.stringify(res.body)).not.toContain('must not leak');
  });

  it('the answers of refused requests carry no status code either', async () => {
    const refused = await request(app).post('/api/estimates').send({});
    const missingToken = await request(app).get('/api/estimates/BP20261013001');
    const unknown = (lookup.mockResolvedValue(null), await request(app).get('/api/estimates/BP20261013001').query({ token: 'x' }));

    for (const res of [refused, missingToken, unknown]) {
      expect(JSON.stringify(res.body)).not.toMatch(INTERNAL_STATUS);
    }
  });
});
