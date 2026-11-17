jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/imageAnalysisService', () => ({
  ...jest.requireActual('../services/imageAnalysisService'),
  analyzeSunglassesImage: jest.fn(),
  isImageAnalysisConfigured: jest.fn()
}));
jest.mock('../services/golfShoeAnalysisService', () => ({
  ...jest.requireActual('../services/golfShoeAnalysisService'),
  analyzeGolfShoeImage: jest.fn()
}));

import request from 'supertest';
import { createApp } from '../app';
import { ImageAnalysisFailedError, analyzeSunglassesImage, isImageAnalysisConfigured } from '../services/imageAnalysisService';
import { analyzeGolfShoeImage } from '../services/golfShoeAnalysisService';
import { ANALYSIS_NOTICE, GOLF_SHOE_ANALYSIS_NOTICE } from '../routes/estimateImageAnalysis';

const ANALYSIS = { is_golf_shoe: true, style: 'sneaker', closure: 'lace', outsole: 'spikeless', upper_material: 'unknown' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
const URL = '/api/estimate-preview/analyze-golf-shoe';

describe('POST /api/estimate-preview/analyze-golf-shoe', () => {
  const analyze = jest.mocked(analyzeGolfShoeImage);
  const sunglasses = jest.mocked(analyzeSunglassesImage);
  const configured = jest.mocked(isImageAnalysisConfigured);

  beforeEach(() => {
    analyze.mockReset().mockResolvedValue(ANALYSIS as never);
    sunglasses.mockReset();
    configured.mockReset().mockReturnValue(true);
  });

  const send = (buffer: Buffer, filename: string, contentType: string) =>
    request(createApp()).post(URL).attach('image', buffer, { filename, contentType });

  it('returns the golf shoe analysis with its own notice, and does not call the sunglasses analysis', async () => {
    const res = await send(PNG, 'shoe.png', 'image/png');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ analysis: ANALYSIS, notice: GOLF_SHOE_ANALYSIS_NOTICE });
    expect(GOLF_SHOE_ANALYSIS_NOTICE).not.toBe(ANALYSIS_NOTICE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(analyze.mock.calls[0][0].equals(PNG)).toBe(true);
    expect(analyze.mock.calls[0][1]).toBe('image/png');
    expect(sunglasses).not.toHaveBeenCalled();
  });

  it('refuses a GIF, a missing image and a file that is not an image, without calling the model', async () => {
    const gif = await send(Buffer.from('GIF89a'), 'shoe.gif', 'image/gif');
    const missing = await request(createApp()).post(URL);
    const fake = await send(Buffer.from('not an image at all'), 'shoe.png', 'image/png');

    expect(gif.body.code).toBe('IMAGE_TYPE_NOT_ALLOWED');
    expect(missing.body.code).toBe('IMAGE_REQUIRED');
    expect(fake.body.code).toBe('IMAGE_INVALID');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('answers 503 when no API key is set up, and 502 when the analysis fails', async () => {
    configured.mockReturnValue(false);
    expect((await send(PNG, 'shoe.png', 'image/png')).status).toBe(503);

    configured.mockReturnValue(true);
    analyze.mockRejectedValue(new ImageAnalysisFailedError('bad answer'));
    const failed = await send(PNG, 'shoe.png', 'image/png');
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('IMAGE_ANALYSIS_FAILED');
  });
});
