import { Router, Request, Response } from 'express';
import { validateSpecification } from '../utils/specification';
import { hashEstimateToken } from '../utils/token';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../services/fileService';
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

    if (uploadedFiles && uploadedFiles.length > 0) {
      const fileValidationErrors: Array<{ filename: string; errors: string[] }> = [];

      for (const file of uploadedFiles) {
        const fileValidation = validateFileBuffer(file.buffer, file.mimetype, file.originalname);
        if (!fileValidation.valid) {
          fileValidationErrors.push({
            filename: file.originalname,
            errors: fileValidation.errors
          });
        }
      }

      if (fileValidationErrors.length > 0) {
        logger.warn('File validation failed for multiple files', {
          category,
          errorCount: fileValidationErrors.length,
          errors: fileValidationErrors
        });

        res.status(400).json({
          error: 'File validation failed',
          details: fileValidationErrors,
          timestamp: new Date().toISOString()
        });
        return;
      }
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
      try {
        const fileData = uploadedFiles.map(file => ({
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalFilename: file.originalname
        }));

        const uploadedFilesList = await uploadMultipleFilesWithMetadata(
          result.estimate_id,
          fileData
        );

        const fileResults = uploadedFilesList.map(file => ({
          id: file.id,
          filename: file.filename,
          size: file.fileSize,
          status: file.status
        }));

        res.status(201).json({
          success: result.success,
          receipt_id: result.receipt_id,
          status: result.status,
          access_token: result.access_token,
          created_at: result.created_at,
          files: fileResults
        });
        return;
      } catch (fileErr) {
        logger.error('File upload failed', {
          receipt_id: result.receipt_id,
          error: fileErr instanceof Error ? fileErr.message : String(fileErr)
        });
        res.status(500).json({
          error: 'File upload failed',
          timestamp: new Date().toISOString()
        });
        return;
      }
    }

    res.status(201).json({
      success: result.success,
      receipt_id: result.receipt_id,
      status: result.status,
      access_token: result.access_token,
      created_at: result.created_at
    });
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
