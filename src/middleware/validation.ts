import { Request, Response, NextFunction } from 'express';
import { validateSpecification, CategoryType } from '../utils/specification';
import logger from '../utils/logger';

export interface ValidatedRequest extends Request {
  validatedCategory?: CategoryType;
  validatedSpecification?: unknown;
}

export function validateEstimateSpecification(
  req: ValidatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const category = req.body?.category;
    const specification = req.body?.specification_json;

    if (!category) {
      res.status(400).json({
        error: 'Missing required field: category',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!['eyewear', 'shoes', 'golf_products', 'other'].includes(category)) {
      res.status(400).json({
        error: `Invalid category: ${category}. Accepted: eyewear, shoes, golf_products, other`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (!specification) {
      res.status(400).json({
        error: 'Missing required field: specification_json',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (typeof specification !== 'object' || specification === null) {
      res.status(400).json({
        error: 'Field specification_json must be an object',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const specWithCategory = {
      ...specification,
      category
    };

    const validationResult = validateSpecification(category, specWithCategory);

    if (!validationResult.valid) {
      logger.warn('Specification validation failed', {
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

    req.validatedCategory = category as CategoryType;
    req.validatedSpecification = specification;

    next();
  } catch (err) {
    logger.error('Specification validation error', {
      error: err instanceof Error ? err.message : String(err)
    });

    res.status(500).json({
      error: 'Internal server error during validation',
      timestamp: new Date().toISOString()
    });
  }
}
