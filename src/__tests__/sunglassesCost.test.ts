jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/sunglassesCostService', () => ({
  ...jest.requireActual('../services/sunglassesCostService'),
  getSunglassesReference: jest.fn()
}));

import request from 'supertest';
import { createApp } from '../app';
import { getSunglassesReference } from '../services/sunglassesCostService';
import { REFERENCE_NOTICE, SIMULATION_NOTICE, UNCONFIRMED_NOTICE } from '../routes/sunglassesCost';

const URL = '/api/estimate-preview/sunglasses-cost';

describe('POST /api/estimate-preview/sunglasses-cost', () => {
  const reference = jest.mocked(getSunglassesReference);

  beforeEach(() => {
    reference.mockReset().mockResolvedValue({ status: 'ok', low: 2.6, high: 4.6, unit_krw: { low: 3400, high: 6100 } });
  });

  it('answers the simulation for TR90 with a TAC polarised lens and 1,000 pairs, apart from the public supplier prices', async () => {
    const res = await request(createApp()).post(URL).send({ frame: 'tr90', lens: 'tac_polarized', quantity: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.spec).toEqual({ frame: 'tr90', lens: 'tac_polarized', mirror: false, gradient: false, photochromic: false, quantity: 1000 });
    expect(res.body.simulation).toMatchObject({
      estimate_type: 'simulation',
      frame_cost: { low: 1.15, high: 1.15 },
      lens_cost: { low: 0.96, high: 0.96 },
      other_cost: 0.6,
      unit_cost: { low: 2.71, high: 2.71 },
      total_cost: { low: 2710, high: 2710 },
      quantity: 1000
    });
    expect(res.body.supplier_reference).toEqual({ status: 'ok', low: 2.6, high: 4.6, unit_krw: { low: 3400, high: 6100 }, notice: REFERENCE_NOTICE });
    expect(res.body.domestic).toEqual({ status: 'insufficient', reason: '국내 기준은 상세견적이 필요한 사양입니다.' });
    expect(res.body.notice).toBe(SIMULATION_NOTICE);
    expect(res.body.assumptions).toEqual([]);
    expect(reference).toHaveBeenCalledWith('tr90');
  });

  it('uses 1,000 pairs when no quantity is sent, and says which parts were not confirmed', async () => {
    const res = await request(createApp()).post(URL).send({ frame: 'pc', lens: 'unknown' });

    expect(res.body.simulation.quantity).toBe(1000);
    expect(res.body.simulation.unconfirmed).toEqual(['lens']);
    expect(res.body.assumptions).toEqual([UNCONFIRMED_NOTICE.lens]);
  });

  it('never tells the customer a source, a supplier or a count of rows', async () => {
    const res = await request(createApp()).post(URL).send({ frame: 'tr90', lens: 'pc_standard' });

    expect(JSON.stringify(res.body)).not.toMatch(/references|evidence_count|supplier_name|example.com|confidence|basis/);
  });

  it('refuses values that are not in the model, without reading the database', async () => {
    for (const body of [
      {},
      { frame: 'titanium', lens: 'pc_standard' },
      { frame: 'pc', lens: 'glass' },
      { frame: 'pc', lens: 'pc_standard', mirror: 'yes' },
      { frame: 'pc', lens: 'pc_standard', quantity: 0 },
      { frame: 'pc', lens: 'pc_standard', quantity: 2.5 }
    ]) {
      const res = await request(createApp()).post(URL).send(body);

      expect(res.status).toBe(400);
    }
    expect(reference).not.toHaveBeenCalled();
  });

  it('answers 500 without the details when the database fails', async () => {
    reference.mockRejectedValue(new Error('connection refused'));

    const res = await request(createApp()).post(URL).send({ frame: 'pc', lens: 'pc_standard' });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});
