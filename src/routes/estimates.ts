import { Router, Request, Response } from 'express';
import { validateSpecification } from '../utils/specification';
import { hashEstimateToken } from '../utils/token';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { uploadMultipleFilesWithMetadata } from '../services/fileService';
import { validateReceiptId } from '../utils/receipt-id';
import { validateCustomerSubmission } from '../utils/customerValidation';
import { getAcceptedConsentVersions } from '../config/privacyConsent';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';
import { config } from '../config/env';
import {
  uploadMiddleware,
  extractMultipartData,
  InvalidSpecificationJsonError
} from '../middleware/upload';
import { validateFileBuffer } from '../utils/fileValidation';
import logger from '../utils/logger';

const router = Router();

router.post('/estimates', uploadMiddleware.array('files', 10), async (req: Request, res: Response) => {
  try {
    // Without an approved privacy consent version no request may be stored (production keeps no
    // approved version until the text has been reviewed). Nothing has been written or numbered yet.
    const acceptedConsentVersions = getAcceptedConsentVersions(config.nodeEnv);
    if (acceptedConsentVersions.length === 0) {
      logger.warn('Estimate intake refused: no approved privacy consent version is configured', {
        code: 'PRIVACY_CONSENT_NOT_CONFIGURED'
      });
      res.status(503).json({
        error: 'Estimate intake is not available yet',
        code: 'PRIVACY_CONSENT_NOT_CONFIGURED',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const {
      category,
      specification_json,
      customer_name,
      customer_email,
      customer_phone,
      company_name,
      customer_type,
      privacy_consent,
      privacy_consent_version,
      uploadedFiles
    } = extractMultipartData(req.body, req.files as Express.Multer.File[] | undefined, {
      multipart: Boolean(req.is('multipart/form-data'))
    });

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

    // Customer details, customer type and consent are all checked here, before the transaction
    // and before a receipt number is taken. Values are never written to the log.
    const contactResult = validateCustomerSubmission(
      {
        customer_name,
        customer_email,
        customer_phone,
        company_name,
        customer_type,
        privacy_consent,
        privacy_consent_version
      },
      { acceptedConsentVersions }
    );

    if (!contactResult.valid) {
      const contactMissing =
        contactResult.errors.length === 1 && contactResult.errors[0].field === 'contact';

      res.status(400).json({
        error: contactMissing
          ? 'Missing required contact: customer_email or customer_phone'
          : 'Invalid customer information',
        details: contactResult.errors,
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
      ...contactResult.value
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
          access_token: result.access_token,
          created_at: result.created_at,
          message: CUSTOMER_GUIDANCE_MESSAGE,
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
      access_token: result.access_token,
      created_at: result.created_at,
      message: CUSTOMER_GUIDANCE_MESSAGE
    });
  } catch (err) {
    if (err instanceof InvalidSpecificationJsonError) {
      res.status(400).json({
        error: 'Invalid specification_json',
        details: ['specification_json is not valid JSON'],
        timestamp: new Date().toISOString()
      });
      return;
    }

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

    // Field by field on purpose: the customer never gets the internal status or anything else
    // the service might add later (PRD FR-4.9.3).
    res.status(200).json({
      receipt_id: estimate.receipt_id,
      category: estimate.category,
      specification_json: estimate.specification_json,
      created_at: estimate.created_at,
      updated_at: estimate.updated_at,
      message: CUSTOMER_GUIDANCE_MESSAGE
    });
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
