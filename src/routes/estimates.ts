import { Router, Request, Response } from 'express';
import { validateSpecification } from '../utils/specification';
import { hashEstimateToken } from '../utils/token';
import { createEstimate, getEstimateByReceiptId } from '../services/estimateService';
import { validateReceiptId } from '../utils/receipt-id';
import logger from '../utils/logger';

const router = Router();

router.post('/estimates', async (req: Request, res: Response) => {
  try {
    const { category, specification_json, customer_name, customer_email, customer_phone, company_name } = req.body;

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
