jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../services/fileService', () => ({
  ...jest.requireActual('../services/fileService'),
  storeFiles: jest.fn(),
  discardStoredFiles: jest.fn()
}));
jest.mock('../services/customerAuthService', () => ({
  ...jest.requireActual('../services/customerAuthService'),
  findSessionCustomer: jest.fn()
}));
jest.mock('../utils/specification', () => ({
  validateSpecification: jest.fn(() => ({ valid: true, errors: [] })),
  stripInvalidAiPreview: jest.fn((specification: unknown) => ({ specification, dropped: false }))
}));

import request from 'supertest';
import { createApp } from '../app';
import { PROFILE, withMultipartProfile } from './helpers/customerFixtures';
import { createEstimate } from '../services/estimateService';
import { storeFiles } from '../services/fileService';
import { findSessionCustomer } from '../services/customerAuthService';

const CUSTOMER_ID = 'c0000000-0000-0000-0000-0000000000c1';
const COOKIE = `bp_session=${'a'.repeat(64)}`;
const created = {
  success: true,
  receipt_id: 'BP20261021001',
  estimate_id: 'e1',
  status: 'new_receipt',
  access_token: 'customer-token',
  created_at: '2026-10-21T00:00:00.000Z'
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

// A request that belongs to a signed-in customer, and the "detailed quote" kind that only they may send.
describe('POST /api/estimates with a customer session and request_kind', () => {
  const app = createApp({ rateLimits: { estimateCreate: { windowMs: 60 * 60 * 1000, max: 1000 } } });
  const body = { ...PROFILE, customer_email: 'buyer@example.com', category: 'eyewear', specification_json: { quantity: 10 } };
  const signedIn = (): void => {
    (findSessionCustomer as jest.Mock).mockResolvedValue({
      customer: { id: CUSTOMER_ID, email: 'buyer@example.com', consent_required: false },
      sessionId: 's1'
    });
  };
  const sent = () => (createEstimate as jest.Mock).mock.calls[0][0];

  beforeEach(() => {
    // Not resetAllMocks: the specification mock above keeps its answer.
    [createEstimate, storeFiles, findSessionCustomer].forEach(mock => (mock as jest.Mock).mockReset());
    (createEstimate as jest.Mock).mockResolvedValue(created);
    (findSessionCustomer as jest.Mock).mockResolvedValue(undefined);
  });

  it('keeps a guest request as it was: no account, the default kind', async () => {
    const res = await request(app).post('/api/estimates').send(body);

    expect(res.status).toBe(201);
    expect(sent().customer_id).toBeUndefined();
    expect(sent().request_kind).toBeUndefined();
    expect(findSessionCustomer).not.toHaveBeenCalled();
  });

  it('links a simple request to the signed-in customer, without changing its kind', async () => {
    signedIn();

    const res = await request(app).post('/api/estimates').set('Cookie', COOKIE).send(body);

    expect(res.status).toBe(201);
    expect(sent().customer_id).toBe(CUSTOMER_ID);
    expect(sent().request_kind).toBeUndefined();
  });

  it('takes a detailed request from a signed-in customer, linked to the account', async () => {
    signedIn();

    const res = await request(app).post('/api/estimates').set('Cookie', COOKIE).send({ ...body, request_kind: 'detailed' });

    expect(res.status).toBe(201);
    expect(sent()).toMatchObject({ customer_id: CUSTOMER_ID, request_kind: 'detailed' });
  });

  it('refuses a detailed request without a session, before anything is stored', async () => {
    const res = await request(app).post('/api/estimates').send({ ...body, request_kind: 'detailed' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CUSTOMER_AUTH_REQUIRED');
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('refuses a detailed request with a session that is not valid (expired, revoked, forged)', async () => {
    (findSessionCustomer as jest.Mock).mockResolvedValue(undefined);

    const res = await request(app).post('/api/estimates').set('Cookie', COOKIE).send({ ...body, request_kind: 'detailed' });

    expect(res.status).toBe(401);
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('does not take the customer id from the body: only the session says who the customer is', async () => {
    signedIn();

    await request(app)
      .post('/api/estimates')
      .set('Cookie', COOKIE)
      .send({ ...body, customer_id: 'c0000000-0000-0000-0000-0000000000ff' });

    expect(sent().customer_id).toBe(CUSTOMER_ID);
    (createEstimate as jest.Mock).mockClear();

    await request(app).post('/api/estimates').send({ ...body, customer_id: 'c0000000-0000-0000-0000-0000000000ff' });
    expect(sent().customer_id).toBeUndefined();
  });

  it.each(['premium', '', 5, null, ['detailed']])('refuses the request_kind %j', async kind => {
    signedIn();

    const res = await request(app).post('/api/estimates').set('Cookie', COOKIE).send({ ...body, request_kind: kind });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('request_kind');
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('takes the kind from a multipart form too, and stores no file for a guest who asked for a detailed quote', async () => {
    const guest = withMultipartProfile(
      request(app).post('/api/estimates').field('category', 'eyewear').field('customer_email', 'buyer@example.com')
    )
      .field('specification_json', JSON.stringify({ quantity: 10 }))
      .field('request_kind', 'detailed')
      .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
    const refused = await guest;
    expect(refused.status).toBe(401);
    expect(storeFiles).not.toHaveBeenCalled();
    expect(createEstimate).not.toHaveBeenCalled();

    signedIn();
    (storeFiles as jest.Mock).mockResolvedValue([]);
    const accepted = await withMultipartProfile(
      request(app).post('/api/estimates').set('Cookie', COOKIE).field('category', 'eyewear').field('customer_email', 'buyer@example.com')
    )
      .field('specification_json', JSON.stringify({ quantity: 10 }))
      .field('request_kind', 'detailed')
      .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(accepted.status).toBe(201);
    expect(sent()).toMatchObject({ customer_id: CUSTOMER_ID, request_kind: 'detailed' });
  });
});
