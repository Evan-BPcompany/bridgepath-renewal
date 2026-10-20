jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/estimateService', () => ({ createEstimate: jest.fn(), getEstimateByReceiptId: jest.fn() }));
jest.mock('../services/fileService', () => ({ storeFiles: jest.fn(), discardStoredFiles: jest.fn() }));

import request from 'supertest';
import logger from '../utils/logger';
import { createApp } from '../app';
import { createEstimate } from '../services/estimateService';
import { stripInvalidAiPreview, validateSpecification } from '../utils/specification';
import { PROFILE } from './helpers/customerFixtures';

const create = createEstimate as jest.Mock;

const PREVIEW = {
  source: 'customer_screen',
  analysis: {
    frame_material: 'acetate',
    lens_type: 'gradient',
    confidence: 'medium',
    complexity: 'medium',
    frame_shape: '스퀘어',
    frame_color: '블랙',
    overview: '두꺼운 아세테이트 프레임의 클래식 선글라스입니다.',
    details: { frame: '두께감 있는 프레임', lens: '그라데이션 틴트', decoration: '은색 핀' },
    cost_factors: ['아세테이트 가공'],
    recommendations: ['사출 프레임으로 변경하면 원가 절감']
  },
  price: {
    currency: 'KRW',
    quantity: 500,
    unit_price: { min: 8300, max: 11300 },
    total_price: { min: 4150000, max: 5650000 }
  }
};

const SPEC = { schema_version: '1.0', frame_type: 'sunglasses', material: 'acetate', lens_type: 'gradient', quantity: 500 };

describe('the AI screen record of a sunglasses request (ai_preview)', () => {
  describe('stripInvalidAiPreview', () => {
    it('keeps a record of the right shape, whole', () => {
      const result = stripInvalidAiPreview({ ...SPEC, ai_preview: PREVIEW });

      expect(result.dropped).toBe(false);
      expect(result.specification).toEqual({ ...SPEC, ai_preview: PREVIEW });
    });

    it('keeps the smallest record: only its source', () => {
      expect(stripInvalidAiPreview({ ...SPEC, ai_preview: { source: 'customer_screen' } }).dropped).toBe(false);
    });

    it('keeps a request without a record as it is', () => {
      expect(stripInvalidAiPreview(SPEC)).toEqual({ specification: SPEC, dropped: false });
    });

    it.each([
      ['an unknown source', { ...PREVIEW, source: 'server' }],
      ['a missing source', { analysis: PREVIEW.analysis }],
      ['an extra key at the top', { ...PREVIEW, secret: 'x' }],
      ['an extra key in the analysis', { ...PREVIEW, analysis: { ...PREVIEW.analysis, is_admin: true } }],
      ['a material that does not exist', { ...PREVIEW, analysis: { ...PREVIEW.analysis, frame_material: 'gold' } }],
      ['an overview over 1000 characters', { ...PREVIEW, analysis: { ...PREVIEW.analysis, overview: 'x'.repeat(1001) } }],
      ['more than four cost factors', { ...PREVIEW, analysis: { ...PREVIEW.analysis, cost_factors: ['1', '2', '3', '4', '5'] } }],
      ['a cost factor that is not text', { ...PREVIEW, analysis: { ...PREVIEW.analysis, cost_factors: [1] } }],
      ['a price in dollars', { ...PREVIEW, price: { ...PREVIEW.price, currency: 'USD' } }],
      ['a price with a fraction', { ...PREVIEW, price: { ...PREVIEW.price, unit_price: { min: 1.5, max: 2 } } }],
      ['a negative price', { ...PREVIEW, price: { ...PREVIEW.price, total_price: { min: -1, max: 2 } } }],
      ['a price without its quantity', { ...PREVIEW, price: { currency: 'KRW', unit_price: PREVIEW.price.unit_price, total_price: PREVIEW.price.total_price } }],
      ['a string', 'hello'],
      ['a list', [PREVIEW]],
      ['null', null]
    ])('drops %s, and keeps the rest of the specification', (_name, preview) => {
      const result = stripInvalidAiPreview({ ...SPEC, ai_preview: preview });

      expect(result.dropped).toBe(true);
      expect(result.specification).toEqual(SPEC);
    });

    it('does not touch what is not an object', () => {
      expect(stripInvalidAiPreview(null)).toEqual({ specification: null, dropped: false });
      expect(stripInvalidAiPreview('x')).toEqual({ specification: 'x', dropped: false });
      expect(stripInvalidAiPreview([1])).toEqual({ specification: [1], dropped: false });
    });
  });

  it('does not get in the way of the specification check', () => {
    expect(validateSpecification('sunglasses', { ...SPEC, material: 'acetate', frame_type: 'sunglasses', ai_preview: PREVIEW }).valid).toBe(true);
  });

  describe('POST /api/estimates', () => {
    beforeEach(() => {
      create.mockReset().mockResolvedValue({
        success: true,
        receipt_id: 'BP20261013001',
        estimate_id: 'x',
        access_token: 'a'.repeat(64),
        created_at: '2026-10-13T03:00:00.000Z'
      });
      jest.spyOn(logger, 'info').mockImplementation(() => logger);
      jest.spyOn(logger, 'warn').mockImplementation(() => logger);
      jest.spyOn(logger, 'error').mockImplementation(() => logger);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const send = (specification: object) =>
      request(createApp())
        .post('/api/estimates')
        .send({ ...PROFILE, category: 'sunglasses', specification_json: specification, customer_email: 'buyer@example.com' });

    it('stores the record with the specification', async () => {
      const res = await send({ ...SPEC, ai_preview: PREVIEW });

      expect(res.status).toBe(201);
      expect(create.mock.calls[0][0].specification_json).toEqual({ ...SPEC, ai_preview: PREVIEW });
    });

    it('goes on without a malformed record: the request is saved, the record is not', async () => {
      const res = await send({ ...SPEC, ai_preview: { ...PREVIEW, secret: 'x' } });

      expect(res.status).toBe(201);
      expect(create.mock.calls[0][0].specification_json).toEqual(SPEC);
      expect(logger.warn).toHaveBeenCalledWith('Dropped an ai_preview that did not fit its shape', { category: 'sunglasses' });
    });

    it('is not in the way of a request without one', async () => {
      const res = await send(SPEC);

      expect(res.status).toBe(201);
      expect(create.mock.calls[0][0].specification_json).toEqual(SPEC);
    });
  });
});
