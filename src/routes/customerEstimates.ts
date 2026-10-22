import { RequestHandler, Router, Request, Response } from 'express';
import { validateReceiptId } from '../utils/receipt-id';
import { getOwnEstimate, listOwnEstimates } from '../services/customerQuoteService';
import { parseInquiryInput } from '../utils/quoteInquiry';
import { InquiryError, createInquiry } from '../services/quoteInquiryService';
import logger from '../utils/logger';

// /api/customers/me/estimates: the requests of the signed-in customer and the detailed quote the staff
// published for them. The session is checked by requireCustomer where this router is mounted (app.ts).
export interface CustomerEstimatesRouterOptions {
  // Per client IP: sending a question or a request for a consultation.
  inquiryLimiter: RequestHandler;
}

export function createCustomerEstimatesRouter(options: CustomerEstimatesRouterOptions): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      res.json({ estimates: await listOwnEstimates(req.customer!.id), timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error('Customer estimate list error', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
    }
  });

  router.get('/:receipt_id', async (req: Request, res: Response) => {
    try {
      const notFound = (): void => {
        res.status(404).json({ error: 'Estimate not found', code: 'ESTIMATE_NOT_FOUND', timestamp: new Date().toISOString() });
      };
      if (!validateReceiptId(req.params.receipt_id)) {
        notFound();
        return;
      }
      const detail = await getOwnEstimate(req.customer!.id, req.params.receipt_id);
      if (!detail) {
        notFound();
        return;
      }
      res.json({ ...detail, timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error('Customer estimate read error', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
    }
  });

  // A question about the published quote (300 characters), or a request that the staff phone the customer.
  router.post('/:receipt_id/inquiries', options.inquiryLimiter, async (req: Request, res: Response) => {
    const stamp = (): string => new Date().toISOString();
    try {
      // JSON only: with the Lax cookie this is what keeps a form on another site from sending it.
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE', timestamp: stamp() });
        return;
      }
      if (!validateReceiptId(req.params.receipt_id)) {
        res.status(404).json({ error: 'Estimate not found', code: 'ESTIMATE_NOT_FOUND', timestamp: stamp() });
        return;
      }
      const parsed = parseInquiryInput(req.body);
      if (!parsed.valid) {
        res.status(400).json({ error: 'Invalid inquiry', code: 'VALIDATION_ERROR', details: parsed.errors, timestamp: stamp() });
        return;
      }

      // The customer is the one of the session; the request has to be theirs.
      const inquiry = await createInquiry(req.customer!.id, req.params.receipt_id, parsed.value);
      res.status(201).json({ inquiry, timestamp: stamp() });
    } catch (err) {
      if (err instanceof InquiryError) {
        const status: Record<string, number> = { ESTIMATE_NOT_FOUND: 404, NO_QUOTE: 409, ALREADY_OPEN: 409, TOO_MANY: 429 };
        const messages: Record<string, string> = {
          ESTIMATE_NOT_FOUND: 'Estimate not found',
          NO_QUOTE: 'There is no published quote to ask about yet',
          ALREADY_OPEN: 'An earlier one of this kind has not been handled yet',
          TOO_MANY: 'Too many questions on this request'
        };
        if (status[err.code]) {
          res.status(status[err.code]).json({ error: messages[err.code], code: err.code, timestamp: stamp() });
          return;
        }
      }
      logger.error('Customer inquiry error', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', timestamp: stamp() });
    }
  });

  return router;
}
