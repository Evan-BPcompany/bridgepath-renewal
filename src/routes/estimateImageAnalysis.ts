import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { validateFileBuffer } from '../utils/fileValidation';
import {
  ANALYSIS_IMAGE_TYPES,
  AnalysisImageType,
  ImageAnalysisFailedError,
  ImageAnalysisNotConfiguredError,
  MAX_ANALYSIS_IMAGE_BYTES,
  analyzeSunglassesImage,
  isImageAnalysisConfigured
} from '../services/imageAnalysisService';
import logger from '../utils/logger';

const router = Router();

// Shown with every analysis: a photo cannot settle material or lens, so the visitor checks it.
export const ANALYSIS_NOTICE =
  '사진으로 추정한 결과예요. 실제와 다를 수 있으니 재질과 렌즈를 확인하고 필요하면 직접 고쳐 주세요.';

// One image, kept in memory only: nothing is written to disk or S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ANALYSIS_IMAGE_BYTES, files: 1 }
});

function fail(res: Response, status: number, error: string, code: string): void {
  res.status(status).json({ error, code, timestamp: new Date().toISOString() });
}

function receiveImage(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      fail(
        res,
        tooBig ? 413 : 400,
        tooBig ? 'Image is larger than 5MB' : 'Invalid image upload',
        tooBig ? 'IMAGE_TOO_LARGE' : 'INVALID_UPLOAD'
      );
      return;
    }
    next(err);
  });
}

// POST /api/estimate-preview/analyze-image: the visitor's photo goes in, the guessed frame material
// and lens type come out. It stores nothing and asks for no personal data.
router.post('/estimate-preview/analyze-image', receiveImage, async (req: Request, res: Response) => {
  try {
    if (!isImageAnalysisConfigured()) {
      fail(res, 503, 'Image analysis is not available yet', 'IMAGE_ANALYSIS_NOT_CONFIGURED');
      return;
    }

    const file = req.file;
    if (!file) {
      fail(res, 400, 'Missing required field: image', 'IMAGE_REQUIRED');
      return;
    }

    const mediaType = file.mimetype as AnalysisImageType;
    if (!ANALYSIS_IMAGE_TYPES.includes(mediaType)) {
      fail(res, 400, 'Only JPG, PNG and GIF images can be analyzed', 'IMAGE_TYPE_NOT_ALLOWED');
      return;
    }

    // The type the browser claims is checked against the first bytes and the file name.
    const validation = validateFileBuffer(file.buffer, mediaType, file.originalname);
    if (!validation.valid) {
      fail(res, 400, 'The file is not a valid image', 'IMAGE_INVALID');
      return;
    }

    const analysis = await analyzeSunglassesImage(file.buffer, mediaType);
    res.json({ analysis, notice: ANALYSIS_NOTICE, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ImageAnalysisNotConfiguredError) {
      fail(res, 503, 'Image analysis is not available yet', 'IMAGE_ANALYSIS_NOT_CONFIGURED');
      return;
    }
    if (err instanceof ImageAnalysisFailedError) {
      fail(res, 502, 'The image could not be analyzed', 'IMAGE_ANALYSIS_FAILED');
      return;
    }
    logger.error('Image analysis request failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    fail(res, 502, 'The image could not be analyzed', 'IMAGE_ANALYSIS_FAILED');
  }
});

export default router;
