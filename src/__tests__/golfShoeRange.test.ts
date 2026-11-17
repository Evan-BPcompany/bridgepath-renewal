jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/priceRangeService', () => ({
  ...jest.requireActual('../services/priceRangeService'),
  getGolfShoeRange: jest.fn()
}));

import request from 'supertest';
import { createApp } from '../app';
import { getGolfShoeRange } from '../services/priceRangeService';
import { RANGE_NOTICE } from '../config/priceRangeRules';

const URL = '/api/estimate-preview/golf-shoe-range';
const BODY = { outsole: 'spikeless', closure: 'dial', upper_material: 'unknown' };
const SOURCE = { title: 'Golf shoe A', url: 'https://example.com/a', supplier: 'Supplier A', price_min: 21, price_max: 22, currency: 'USD', collected_at: '2026-11-17', kind: 'listing', similarity: 1 };
const RESULT = {
  spec: BODY,
  overseas: { status: 'ok', currency: 'USD', low: 24.2, mid: 26.4, high: 30.8, krw_low: 32000, krw_high: 40800, basis: 'listing', confidence: 'low', evidence_count: 6, supplier_count: 6, references: [SOURCE], retail_references: [SOURCE] },
  domestic: { status: 'insufficient', currency: 'KRW', evidence_count: 0, supplier_count: 0, reason: '국내 기준은 상세견적이 필요한 사양입니다.', references: [], retail_references: [] }
};

describe('POST /api/estimate-preview/golf-shoe-range', () => {
  const range = jest.mocked(getGolfShoeRange);

  beforeEach(() => {
    range.mockReset().mockResolvedValue(RESULT as never);
  });

  it('returns both ranges in won for one pair and for the minimum order, and the notice, and reads only the three values of the analysis', async () => {
    const res = await request(createApp()).post(URL).send({ ...BODY, price: 1, quantity: 5 });

    expect(res.status).toBe(200);
    // a dial closure: 800 pairs
    expect(res.body).toMatchObject({ spec: BODY, unit: 'pair', moq: 800, notice: RANGE_NOTICE });
    expect(res.body.overseas).toEqual({
      status: 'ok', currency: 'USD', low: 24.2, high: 30.8,
      unit_krw: { low: 32000, high: 40800 }, total_krw: { low: 25600000, high: 32640000 }
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(range).toHaveBeenCalledWith({ outsole: 'spikeless', closure: 'dial', upper_material: 'unknown' });
  });

  it('answers "cannot quote" with 200, not an error', async () => {
    const res = await request(createApp()).post(URL).send(BODY);

    expect(res.body.domestic.status).toBe('insufficient');
    expect(res.body.domestic).toEqual({ status: 'insufficient', currency: 'KRW', reason: '국내 기준은 상세견적이 필요한 사양입니다.' });
  });

  it('refuses a value that is not one of the analysis values, without reading the database', async () => {
    for (const body of [{}, { ...BODY, outsole: 'cleats' }, { ...BODY, closure: 'boa' }, { ...BODY, upper_material: 5 }, { outsole: 'spike' }]) {
      const res = await request(createApp()).post(URL).send(body);

      expect(res.status).toBe(400);
      expect(res.body.details.length).toBeGreaterThan(0);
    }
    expect(range).not.toHaveBeenCalled();
  });

  it('answers 500 without the details when the database fails', async () => {
    range.mockRejectedValue(new Error('connection refused'));

    const res = await request(createApp()).post(URL).send(BODY);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});

describe('what a customer is never told by the golf shoe range', () => {
  it('has no source, no web address, no supplier and no count of rows anywhere in the answer', async () => {
    jest.mocked(getGolfShoeRange).mockResolvedValue(RESULT as never);

    const res = await request(createApp()).post(URL).send(BODY);
    const text = JSON.stringify(res.body);

    expect(text).not.toMatch(/references|retail_references|evidence_count|supplier|example.com|Golf shoe A|confidence|basis/);
  });
});

describe('the minimum order of the golf shoe range (300 pairs, 800 with spikes or a dial)', () => {
  const moqOf = async (spec: { outsole: string; closure: string; upper_material: string }) => {
    jest.mocked(getGolfShoeRange).mockResolvedValue({ ...RESULT, spec } as never);
    const res = await request(createApp()).post(URL).send(spec);
    return res.body;
  };

  it('is 800 pairs for spikes and for a dial, and the total budget is the range times it', async () => {
    const spike = await moqOf({ outsole: 'spike', closure: 'lace', upper_material: 'leather' });
    const dial = await moqOf({ outsole: 'spikeless', closure: 'dial', upper_material: 'leather' });

    expect(spike.moq).toBe(800);
    expect(dial.moq).toBe(800);
    expect(spike.overseas.total_krw).toEqual({ low: 32000 * 800, high: 40800 * 800 });
  });

  it('is 300 pairs for every other shoe, and the total budget follows', async () => {
    const lace = await moqOf({ outsole: 'spikeless', closure: 'lace', upper_material: 'microfiber' });
    const unknown = await moqOf({ outsole: 'unknown', closure: 'unknown', upper_material: 'unknown' });

    expect(lace.moq).toBe(300);
    expect(unknown.moq).toBe(300);
    expect(lace.overseas.total_krw).toEqual({ low: 32000 * 300, high: 40800 * 300 });
  });
});
