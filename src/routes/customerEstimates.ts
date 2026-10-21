import { Router, Request, Response } from 'express';
import { validateReceiptId } from '../utils/receipt-id';
import { getOwnEstimate, listOwnEstimates } from '../services/customerQuoteService';
import logger from '../utils/logger';

// /api/customers/me/estimates: the requests of the signed-in customer and the detailed quote the staff
// published for them. The session is checked by requireCustomer where this router is mounted (app.ts).
export function createCustomerEstimatesRouter(): Router {
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

  return router;
}
