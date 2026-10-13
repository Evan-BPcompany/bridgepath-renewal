jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({
  createEstimate: jest.fn(),
  getEstimateByReceiptId: jest.fn()
}));
jest.mock('../utils/specification', () => ({
  validateSpecification: jest.fn(() => ({ valid: true, errors: [] }))
}));

import request from 'supertest';
import { createApp } from '../app';
import { createEstimate } from '../services/estimateService';

const createdResult = {
  success: true,
  receipt_id: 'BP20261013001',
  estimate_id: 'e1',
  status: 'new_receipt',
  access_token: 'customer-token',
  created_at: '2026-10-13T00:00:00.000Z'
};

describe('POST /api/estimates contact policy (email OR phone)', () => {
  const app = createApp();
  const base = { category: 'eyewear', specification_json: { quantity: 10 } };

  beforeEach(() => {
    (createEstimate as jest.Mock).mockReset();
    (createEstimate as jest.Mock).mockResolvedValue(createdResult);
  });

  it('accepts a request with only a phone number', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_phone: '010-1234-5678' });

    expect(res.status).toBe(201);
    expect(createEstimate).toHaveBeenCalledTimes(1);
    const arg = (createEstimate as jest.Mock).mock.calls[0][0];
    expect(arg.customer_phone).toBe('010-1234-5678');
    expect(arg.customer_email).toBeUndefined();
  });

  it('accepts a request with only an email', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_email: 'buyer@example.com' });

    expect(res.status).toBe(201);
    const arg = (createEstimate as jest.Mock).mock.calls[0][0];
    expect(arg.customer_email).toBe('buyer@example.com');
    expect(arg.customer_phone).toBeUndefined();
  });

  it('passes trimmed values to the service', async () => {
    await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_email: '  buyer@example.com ', customer_name: ' Kim ', company_name: ' ' });

    const arg = (createEstimate as jest.Mock).mock.calls[0][0];
    expect(arg.customer_email).toBe('buyer@example.com');
    expect(arg.customer_name).toBe('Kim');
    expect(arg.company_name).toBeUndefined();
  });

  it('returns 400 when both email and phone are missing', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_name: 'Kim' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required contact: customer_email or customer_phone');
    expect(res.body.details[0].field).toBe('contact');
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('returns 400 when email and phone are both blank', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_email: '   ', customer_phone: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required contact: customer_email or customer_phone');
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('returns 400 with field details for an invalid email', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_email: 'nope', customer_phone: '010-1234-5678' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid customer information');
    expect(res.body.details).toEqual([{ field: 'customer_email', message: expect.any(String) }]);
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('returns 400 for over-long names and phone numbers instead of failing in the database', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({
        ...base,
        customer_email: 'buyer@example.com',
        customer_name: 'x'.repeat(101),
        customer_phone: '1'.repeat(21),
        company_name: 'y'.repeat(101)
      });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'company_name',
      'customer_name',
      'customer_phone'
    ]);
  });

  it('returns 400 for non-string contact values', async () => {
    const res = await request(app)
      .post('/api/estimates')
      .send({ ...base, customer_email: 12345 });

    expect(res.status).toBe(400);
    expect(createEstimate).not.toHaveBeenCalled();
  });

  it('applies the same rule to multipart form requests', async () => {
    const missing = await request(app)
      .post('/api/estimates')
      .field('category', 'eyewear')
      .field('specification_json', JSON.stringify({ quantity: 10 }));
    expect(missing.status).toBe(400);

    const ok = await request(app)
      .post('/api/estimates')
      .field('category', 'eyewear')
      .field('specification_json', JSON.stringify({ quantity: 10 }))
      .field('customer_phone', '010-1234-5678');
    expect(ok.status).toBe(201);
  });
});
