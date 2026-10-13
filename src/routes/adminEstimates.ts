import { Router, Request, RequestHandler, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  isUuid,
  parseListQuery,
  parseStatusBody,
  requireJson,
  sendError
} from '../middleware/adminValidation';
import {
  changeEstimateStatus,
  getEstimateDetail,
  listEstimates
} from '../services/adminEstimateService';
import adminFilesRouter from './adminFiles';
import adminMemosRouter from './adminMemos';
import { STATUS_ERRORS } from '../utils/statusTransitions';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

// Route handlers only. Authentication, the role check and rate limiting are applied by
// createAdminEstimatesRouter below, so this router is never exposed without them.
const router = Router();

router.use('/:id/memos', adminMemosRouter);
router.use('/:id/files', adminFilesRouter);

const STATUS_ERROR_MESSAGES: Record<string, string> = {
  ESTIMATE_NOT_FOUND: 'Estimate not found',
  STATUS_CONFLICT: 'Estimate status has changed since it was loaded',
  SAME_STATUS: 'Estimate is already in the requested status',
  INVALID_TRANSITION: 'This status transition is not allowed',
  INSUFFICIENT_ROLE: 'Your role is not allowed to perform this status transition',
  REASON_REQUIRED: 'A reason is required for this status transition'
};

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseListQuery(req.query);

    if (!parsed.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', parsed.errors);
      return;
    }

    const { items, total } = await listEstimates(parsed.value);
    const { page, limit } = parsed.value;

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    logger.error('Admin estimate list error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;

  try {
    if (!isUuid(id)) {
      sendError(res, 400, STATUS_ERRORS.INVALID_ID.code, 'Estimate id must be a UUID');
      return;
    }

    const detail = await getEstimateDetail(id);

    if (!detail) {
      logAdminAudit({
        action: 'estimate.detail.view',
        result: 'not_found',
        http_status: 404,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        ip: req.ip
      });
      sendError(res, 404, STATUS_ERRORS.ESTIMATE_NOT_FOUND.code, 'Estimate not found');
      return;
    }

    logAdminAudit({
      action: 'estimate.detail.view',
      result: 'success',
      http_status: 200,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      ip: req.ip
    });

    res.json({ success: true, data: detail });
  } catch (err) {
    logger.error('Admin estimate detail error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.patch('/:id/status', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;

  try {
    if (!isUuid(id)) {
      sendError(res, 400, STATUS_ERRORS.INVALID_ID.code, 'Estimate id must be a UUID');
      return;
    }

    const body = parseStatusBody(req.body);

    if (!body.valid) {
      sendError(res, 400, body.code, body.message);
      return;
    }

    const outcome = await changeEstimateStatus({
      estimateId: id,
      toStatus: body.value.toStatus,
      reason: body.value.reason,
      expectedStatus: body.value.expectedStatus,
      admin: { id: admin.id, role: admin.role }
    });

    if (!outcome.ok) {
      logAdminAudit({
        action: 'estimate.status.change',
        result: 'denied',
        http_status: outcome.error.http,
        error_code: outcome.error.code,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        from_status: outcome.currentStatus,
        to_status: body.value.toStatus,
        ip: req.ip
      });

      res.status(outcome.error.http).json({
        error: STATUS_ERROR_MESSAGES[outcome.error.code] ?? 'Status change failed',
        code: outcome.error.code,
        ...(outcome.error.code === 'STATUS_CONFLICT' ? { current_status: outcome.currentStatus } : {}),
        timestamp: new Date().toISOString()
      });
      return;
    }

    logAdminAudit({
      action: 'estimate.status.change',
      result: 'success',
      http_status: 200,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      from_status: outcome.data.previous_status,
      to_status: outcome.data.status,
      ip: req.ip
    });

    res.json({ success: true, data: outcome.data });
  } catch (err) {
    logger.error('Admin status change error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export interface AdminEstimatesRouterDeps {
  mutationLimiter: RequestHandler;
}

export function createAdminEstimatesRouter(deps: AdminEstimatesRouterDeps): Router {
  const guarded = Router();

  guarded.use(authMiddleware);
  guarded.use(requireRole('manager'));

  // After authentication so the limit follows the admin, not the IP.
  guarded.use(deps.mutationLimiter);

  guarded.use(router);

  return guarded;
}
