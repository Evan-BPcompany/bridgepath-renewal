import { RequestHandler, Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { parseInboxQuery, sendError } from '../middleware/adminValidation';
import { listInbox } from '../services/quoteInquiryService';
import logger from '../utils/logger';

// GET /admin/inquiries: the inbox of the staff. What the customers asked about their quotes (questions and
// requests for a consultation), over all requests, so nobody has to open the requests one by one. Reading
// only: answering and closing are done on the request itself (adminInquiries.ts).
const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseInboxQuery(req.query);
    if (!parsed.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', parsed.errors);
      return;
    }

    const { items, total, counts } = await listInbox(parsed.value);
    const { page, limit } = parsed.value;

    res.json({
      success: true,
      data: items,
      counts,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    logger.error('Admin inbox error', { error: err instanceof Error ? err.message : String(err) });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export interface AdminInboxRouterDeps {
  mutationLimiter: RequestHandler;
}

// Behind the admin login, the manager role and the same limit as the other admin routes.
export function createAdminInboxRouter(deps: AdminInboxRouterDeps): Router {
  const guarded = Router();
  guarded.use(authMiddleware);
  guarded.use(requireRole('manager'));
  guarded.use(deps.mutationLimiter);
  guarded.use(router);
  return guarded;
}
