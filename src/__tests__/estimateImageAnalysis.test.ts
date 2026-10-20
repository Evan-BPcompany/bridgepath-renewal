jest.mock('../config/database', () => ({ getPool: jest.fn() }));
jest.mock('../services/imageAnalysisService', () => ({
  ...jest.requireActual('../services/imageAnalysisService'),
  analyzeSunglassesImage: jest.fn(),
  isImageAnalysisConfigured: jest.fn()
}));

import request from 'supertest';
import { createApp } from '../app';
import {
  analyzeSunglassesImage,
  ImageAnalysisFailedError,
  isImageAnalysisConfigured
} from '../services/imageAnalysisService';
import { ANALYSIS_NOTICE } from '../routes/estimateImageAnalysis';

// The service is a mock: no call to the Claude API, no key needed.
const ANALYSIS = {
  is_sunglasses: true,
  frame_material: 'metal',
  lens_type: 'mirror',
  confidence: 'high',
  summary: '메탈 프레임에 미러 렌즈예요.'
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]);
const URL = '/api/estimate-preview/analyze-image';

describe('POST /api/estimate-preview/analyze-image', () => {
  const analyze = jest.mocked(analyzeSunglassesImage);
  const configured = jest.mocked(isImageAnalysisConfigured);

  beforeEach(() => {
    analyze.mockReset().mockResolvedValue(ANALYSIS as never);
    configured.mockReset().mockReturnValue(true);
  });

  const send = (buffer: Buffer, filename: string, contentType: string, app = createApp()) =>
    request(app).post(URL).attach('image', buffer, { filename, contentType });

  it('returns the analysis and the notice for a PNG', async () => {
    const res = await send(PNG, 'frame.png', 'image/png');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ analysis: ANALYSIS, notice: ANALYSIS_NOTICE });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0].equals(PNG)).toBe(true);
    expect(analyze.mock.calls[0][1]).toBe('image/png');
  });

  it('accepts a WEBP', async () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8)]);

    const res = await send(webp, 'frame.webp', 'image/webp');

    expect(res.status).toBe(200);
    expect(analyze.mock.calls[0][1]).toBe('image/webp');
  });

  it('refuses a GIF: it is not an allowed attachment type either', async () => {
    const res = await send(Buffer.from('GIF89a'), 'frame.gif', 'image/gif');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMAGE_TYPE_NOT_ALLOWED');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('accepts a JPEG', async () => {
    const res = await send(JPEG, 'frame.jpg', 'image/jpeg');

    expect(res.status).toBe(200);
    expect(analyze.mock.calls[0][1]).toBe('image/jpeg');
  });

  it('answers 503 and sends nothing when no API key is set up', async () => {
    configured.mockReturnValue(false);

    const res = await send(PNG, 'frame.png', 'image/png');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('IMAGE_ANALYSIS_NOT_CONFIGURED');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('answers 400 when there is no image', async () => {
    const res = await request(createApp()).post(URL).field('note', 'hello');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMAGE_REQUIRED');
    expect(analyze).not.toHaveBeenCalled();
  });

  it.each([
    ['a PDF', Buffer.from('%PDF-1.4 test'), 'doc.pdf', 'application/pdf'],
    ['a text file', Buffer.from('hello'), 'a.txt', 'text/plain'],
    ['an SVG', Buffer.from('<svg/>'), 'a.svg', 'image/svg+xml']
  ])('refuses %s without calling the model', async (_name, buffer, filename, contentType) => {
    const res = await send(buffer, filename, contentType);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMAGE_TYPE_NOT_ALLOWED');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('refuses a file whose bytes do not match the type it claims', async () => {
    const res = await send(Buffer.from('not really a png'), 'fake.png', 'image/png');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMAGE_INVALID');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('refuses an image larger than 5MB with 413', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);

    const res = await send(big, 'big.png', 'image/png');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('IMAGE_TOO_LARGE');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('answers 502 when the model could not analyze the image', async () => {
    analyze.mockRejectedValue(new ImageAnalysisFailedError('The model declined'));

    const res = await send(PNG, 'frame.png', 'image/png');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('IMAGE_ANALYSIS_FAILED');
  });

  it('answers 502 without details when the API call itself fails', async () => {
    analyze.mockRejectedValue(new Error('401 invalid x-api-key sk-ant-secret'));

    const res = await send(PNG, 'frame.png', 'image/png');

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-ant|x-api-key|401/);
  });

  it('is rate limited per client IP, before the image is read', async () => {
    const app = createApp({ rateLimits: { imageAnalysis: { windowMs: 60000, max: 1 } } });

    const first = await send(PNG, 'frame.png', 'image/png', app);
    const second = await send(PNG, 'frame.png', 'image/png', app);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('RATE_LIMITED');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
