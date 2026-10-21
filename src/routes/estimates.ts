import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { stripInvalidAiPreview, validateSpecification } from '../utils/specification';
import { hashEstimateToken } from '../utils/token';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { discardStoredFiles, storeFiles, StoredFile } from '../services/fileService';
import { validateReceiptId } from '../utils/receipt-id';
import { validateCustomerSubmission } from '../utils/customerValidation';
import { getAcceptedConsentVersions } from '../config/privacyConsent';
import { CUSTOMER_GUIDANCE_MESSAGE } from '../utils/customerMessages';
import { config } from '../config/env';
import {
  receiveFiles,
  extractMultipartData,
  InvalidSpecificationJsonError
} from '../middleware/upload';
import { validateFileBuffer, validateFileSet } from '../utils/fileValidation';
import logger from '../utils/logger';
import { readCustomerSession } from '../middleware/customerAuth';

const router = Router();

// The session is read after the body is parsed: a signed-in customer's request is linked to the
// account, and a "detailed" request (the staff write a detailed quote) is only for signed-in customers.
router.post('/estimates', receiveFiles, readCustomerSession, async (req: Request, res: Response) => {
  try {
    const rawKind = (req.body as Record<string, unknown> | undefined)?.request_kind;
    if (rawKind !== undefined && rawKind !== 'simple' && rawKind !== 'detailed') {
      res.status(400).json({
        error: 'Invalid request_kind',
        details: [{ field: 'request_kind', message: 'must be simple or detailed' }],
        timestamp: new Date().toISOString()
      });
      return;
    }
    const requestKind: 'simple' | 'detailed' = rawKind === 'detailed' ? 'detailed' : 'simple';
    if (requestKind === 'detailed' && !req.customer) {
      res.status(401).json({
        error: 'Sign in to ask for a detailed quote',
        code: 'CUSTOMER_AUTH_REQUIRED',
        timestamp: new Date().toISOString()
      });
      return;
    }

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

    // The AI screen record is advisory: a malformed one is dropped, the request goes on.
    const { specification: cleanSpecification, dropped: aiPreviewDropped } = stripInvalidAiPreview(specification_json);
    if (aiPreviewDropped) {
      logger.warn('Dropped an ai_preview that did not fit its shape', { category });
    }

    const files = uploadedFiles ?? [];

    if (files.length > 0) {
      const fileValidationErrors: Array<{ filename: string; errors: string[] }> = [];

      // How many and how large together (PRD FR-2.6), then each file by its content (FR-2.7).
      const setValidation = validateFileSet(files.map(file => file.size));
      if (!setValidation.valid) {
        fileValidationErrors.push({ filename: '', errors: setValidation.errors });
      }

      for (const file of files) {
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

    // A request with files is saved with all of them or not at all (PRD FR-4.7): the files go to
    // the storage first, under the id the estimate will have, and the estimate and its file rows are
    // written in one transaction. If either step fails nothing is left behind, the customer gets no
    // receipt number, and trying again cannot make a second request.
    const estimateId = files.length > 0 ? randomUUID() : undefined;
    let storedFiles: StoredFile[] = [];

    if (estimateId) {
      try {
        storedFiles = await storeFiles(
          estimateId,
          files.map(file => ({
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalFilename: file.originalname
          }))
        );
      } catch (fileErr) {
        logger.error('File upload failed, nothing was saved', {
          error: fileErr instanceof Error ? fileErr.message : String(fileErr)
        });
        res.status(500).json({
          error: 'File upload failed',
          code: 'FILE_UPLOAD_FAILED',
          timestamp: new Date().toISOString()
        });
        return;
      }
    }

    let result;
    try {
      result = await createEstimate({
        category,
        specification_json: cleanSpecification,
        ...contactResult.value,
        estimate_id: estimateId,
        files: storedFiles,
        customer_id: req.customer?.id,
        request_kind: requestKind === 'detailed' ? 'detailed' : undefined
      });
    } catch (createErr) {
      await discardStoredFiles(storedFiles);
      throw createErr;
    }

    res.status(201).json({
      success: result.success,
      receipt_id: result.receipt_id,
      access_token: result.access_token,
      created_at: result.created_at,
      message: CUSTOMER_GUIDANCE_MESSAGE,
      ...(storedFiles.length > 0
        ? {
            files: storedFiles.map(file => ({
              id: file.id,
              filename: file.filename,
              size: file.fileSize,
              status: file.status
            }))
          }
        : {})
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
