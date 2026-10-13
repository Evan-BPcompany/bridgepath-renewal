import { Router, Request, Response } from 'express';
import {
  isUuid,
  parseMemoBody,
  parsePageQuery,
  requireJson,
  sendError
} from '../middleware/adminValidation';
import { createMemo, listMemos } from '../services/adminMemoService';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

// Mounted under /admin/estimates/:id/memos, behind the authentication and role checks
// of the parent router.
const router = Router({ mergeParams: true });

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;

  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }

    const paging = parsePageQuery(req.query);
    if (!paging.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', paging.errors);
      return;
    }

    const result = await listMemos(id, paging.value);

    if (!result) {
      logAdminAudit({
        action: 'memo.list.view',
        result: 'not_found',
        http_status: 404,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        ip: req.ip
      });
      sendError(res, 404, 'ESTIMATE_NOT_FOUND', 'Estimate not found');
      return;
    }

    logAdminAudit({
      action: 'memo.list.view',
      result: 'success',
      http_status: 200,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      ip: req.ip
    });

    const { page, limit } = paging.value;
    res.json({
      success: true,
      data: result.items,
      pagination: {
        page,
        limit,
        total: result.total,
        total_pages: Math.ceil(result.total / limit)
      }
    });
  } catch (err) {
    logger.error('Admin memo list error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.post('/', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;

  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }

    const body = parseMemoBody(req.body);
    if (!body.valid) {
      sendError(res, 400, body.code, body.message);
      return;
    }

    // The author always comes from the authenticated session, never from the request body.
    const memo = await createMemo({
      estimateId: id,
      admin: { id: admin.id, username: admin.username },
      content: body.content
    });

    if (!memo) {
      logAdminAudit({
        action: 'memo.create',
        result: 'not_found',
        http_status: 404,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        ip: req.ip
      });
      sendError(res, 404, 'ESTIMATE_NOT_FOUND', 'Estimate not found');
      return;
    }

    logAdminAudit({
      action: 'memo.create',
      result: 'success',
      http_status: 201,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      memo_id: memo.id,
      ip: req.ip
    });

    res.status(201).json({ success: true, data: memo });
  } catch (err) {
    logger.error('Admin memo create error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export default router;
