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
import { analyzeGolfShoeImage } from '../services/golfShoeAnalysisService';
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

export const GOLF_SHOE_ANALYSIS_NOTICE =
  '사진으로 추정한 결과예요. 실제와 다를 수 있으니 어퍼 재질과 아웃솔을 확인하고 필요하면 직접 고쳐 주세요.';

type Analyze = (image: Buffer, mediaType: AnalysisImageType) => Promise<unknown>;

// The visitor's photo goes in, what the analysis guessed comes out. It stores nothing and asks for no personal data.
const analysisHandler = (analyze: Analyze, notice: string) => async (req: Request, res: Response) => {
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
      fail(res, 400, 'Only JPG, PNG and WEBP images can be analyzed', 'IMAGE_TYPE_NOT_ALLOWED');
      return;
    }

    // The type the browser claims is checked against the first bytes and the file name.
    const validation = validateFileBuffer(file.buffer, mediaType, file.originalname);
    if (!validation.valid) {
      fail(res, 400, 'The file is not a valid image', 'IMAGE_INVALID');
      return;
    }

    const analysis = await analyze(file.buffer, mediaType);
    res.json({ analysis, notice, timestamp: new Date().toISOString() });
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
};

// POST /api/estimate-preview/analyze-image: the guessed frame material and lens type of a sunglasses photo.
router.post(
  '/estimate-preview/analyze-image',
  receiveImage,
  analysisHandler((image, mediaType) => analyzeSunglassesImage(image, mediaType), ANALYSIS_NOTICE)
);

// POST /api/estimate-preview/analyze-golf-shoe: the closure, outsole, upper material and difficulty of a golf shoe photo.
router.post(
  '/estimate-preview/analyze-golf-shoe',
  receiveImage,
  analysisHandler((image, mediaType) => analyzeGolfShoeImage(image, mediaType), GOLF_SHOE_ANALYSIS_NOTICE)
);

export default router;
