import { Router, Request, Response } from 'express';
import { validateSpecification } from '../utils/specification';
import { hashEstimateToken } from '../utils/token';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { uploadFileWithMetadata } from '../services/fileService';
import { validateReceiptId } from '../utils/receipt-id';
import { uploadMiddleware, extractMultipartData } from '../middleware/upload';
import { validateFileBuffer } from '../utils/fileValidation';
import logger from '../utils/logger';

const router = Router();

router.post('/estimates', uploadMiddleware.array('files', 10), async (req: Request, res: Response) => {
  try {
    const { category, specification_json, customer_name, customer_email, customer_phone, company_name, uploadedFiles } = extractMultipartData(
      req.body,
      req.files as Express.Multer.File[] | undefined
    );

    if (!category) {
      res.status(400).json({
        error: 'Missing required field: category',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!specification_json) {
      res.status(400).json({
        error: 'Missing required field: specification_json',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const validationResult = validateSpecification(category, specification_json);

    if (!validationResult.valid) {
      logger.warn('Specification validation failed for estimate', {
        category,
        errors: validationResult.errors
      });

      res.status(400).json({
        error: 'Invalid specification_json',
        details: validationResult.errors,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const result = await createEstimate({
      category,
      specification_json,
      customer_name,
      customer_email,
      customer_phone,
      company_name
    });

    if (uploadedFiles && uploadedFiles.length > 0) {
      const fileResults = [];
      for (const file of uploadedFiles) {
        try {
          const fileValidation = validateFileBuffer(file.buffer, file.mimetype, file.originalname);
          if (!fileValidation.valid) {
            logger.warn('File validation failed', {
              filename: file.originalname,
              errors: fileValidation.errors
            });
            continue;
          }

          const uploadedFile = await uploadFileWithMetadata(
            result.receipt_id,
            file.buffer,
            file.mimetype,
            file.originalname
          );
          fileResults.push({
            id: uploadedFile.id,
            filename: uploadedFile.filename,
            size: uploadedFile.fileSize,
            status: uploadedFile.status
          });
        } catch (fileErr) {
          logger.error('File upload failed', {
            filename: file.originalname,
            error: fileErr instanceof Error ? fileErr.message : String(fileErr)
          });
        }
      }

      res.status(201).json({
        ...result,
        files: fileResults
      });
      return;
    }

    res.status(201).json(result);
  } catch (err) {
    logger.error('Error creating estimate', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/estimates/:receipt_id', async (req: Request, res: Response) => {
  try {
    const { receipt_id } = req.params;
    const { token } = req.query;

    if (!validateReceiptId(receipt_id)) {
      res.status(404).json({
        error: 'Not found',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!token || typeof token !== 'string') {
      res.status(401).json({
        error: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const tokenHash = hashEstimateToken(token);
    const estimate = await getEstimateByReceiptId(receipt_id, tokenHash);

    if (!estimate) {
      res.status(401).json({
        error: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
      return;
    }

    res.status(200).json(estimate);
  } catch (err) {
    logger.error('Error retrieving estimate', {
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
