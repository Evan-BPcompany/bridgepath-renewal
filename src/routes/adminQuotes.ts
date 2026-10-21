import { Router, Request, Response } from 'express';
import { isUuid, requireJson, sendError } from '../middleware/adminValidation';
import { QuoteError, getQuoteContext, publishQuote, saveQuote } from '../services/adminQuoteService';
import { parseQuoteInput } from '../utils/detailedQuote';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

// Mounted under /admin/estimates/:id/quote, behind the authentication, the role check and the rate
// limit of the parent router. The staff write the quote; the customer's side is in customerEstimates.ts.
const router = Router({ mergeParams: true });

const MESSAGES: Record<string, { http: number; message: string }> = {
  ESTIMATE_NOT_FOUND: { http: 404, message: 'Estimate not found' },
  NO_CUSTOMER_ACCOUNT: {
    http: 409,
    message: 'This request was sent without an account, so the customer cannot see a quote on the site'
  },
  QUOTE_CONFLICT: { http: 409, message: 'The quote was changed by someone else since it was loaded' },
  NO_QUOTE: { http: 404, message: 'There is no quote to publish for this estimate' },
  QUOTE_INCOMPLETE: { http: 400, message: 'The quote needs at least one item, a total above 0 and a validity date that is not past' },
  NOTHING_TO_PUBLISH: { http: 409, message: 'The quote has not changed since it was published' }
};

function answerError(res: Response, err: unknown, action: string, base: { admin_id: string; role: string; estimate_id: string; ip?: string }): void {
  if (err instanceof QuoteError) {
    const mapped = MESSAGES[err.code];
    logAdminAudit({ action, result: 'denied', http_status: mapped.http, error_code: err.code, ...base });
    sendError(res, mapped.http, err.code, mapped.message);
    return;
  }
  logger.error('Admin quote error', { action, error: err instanceof Error ? err.message : String(err) });
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }
    const context = await getQuoteContext(id);
    if (!context) {
      sendError(res, 404, 'ESTIMATE_NOT_FOUND', 'Estimate not found');
      return;
    }
    res.json({ success: true, data: context });
  } catch (err) {
    answerError(res, err, 'quote.read', { admin_id: req.admin!.id, role: req.admin!.role, estimate_id: String(id), ip: req.ip });
  }
});

// Saves the working copy (never visible to the customer).
router.put('/', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;
  const base = { admin_id: admin.id, role: admin.role, estimate_id: String(id), ip: req.ip };
  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }
    const parsed = parseQuoteInput(req.body);
    if (!parsed.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid quote', parsed.errors);
      return;
    }

    // The author comes from the session, never from the body.
    const quote = await saveQuote(id, admin.id, parsed.value);

    logAdminAudit({ action: 'quote.save', result: 'success', http_status: 200, quote_id: quote.id, ...base });
    res.json({ success: true, data: quote });
  } catch (err) {
    answerError(res, err, 'quote.save', base);
  }
});

// Publishes the working copy: from now on the customer sees it. Names the save that was on the screen.
router.post('/publish', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;
  const base = { admin_id: admin.id, role: admin.role, estimate_id: String(id), ip: req.ip };
  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }
    const seq = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).expected_edit_seq : undefined;
    if (!Number.isInteger(seq) || (seq as number) < 1) {
      sendError(res, 400, 'VALIDATION_ERROR', 'expected_edit_seq is required', [{ field: 'expected_edit_seq', message: 'must be a whole number from 1' }]);
      return;
    }

    const quote = await publishQuote(id, admin.id, seq as number);

    logAdminAudit({
      action: 'quote.publish',
      result: 'success',
      http_status: 200,
      quote_id: quote.id,
      quote_version: quote.version,
      ...base
    });
    res.json({ success: true, data: quote });
  } catch (err) {
    answerError(res, err, 'quote.publish', base);
  }
});

export default router;
