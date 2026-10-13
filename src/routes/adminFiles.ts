import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { isUuid, sendError } from '../middleware/adminValidation';
import { findEstimateFile, listEstimateFiles } from '../services/adminFileService';
import { decideFileDownload, downloadProvider } from '../services/fileDownload';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

// Mounted under /admin/estimates/:id/files, behind the authentication and role checks
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

    const files = await listEstimateFiles(id);

    if (!files) {
      logAdminAudit({
        action: 'file.list.view',
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
      action: 'file.list.view',
      result: 'success',
      http_status: 200,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      ip: req.ip
    });

    res.json({ success: true, data: files });
  } catch (err) {
    logger.error('Admin file list error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

router.get('/:fileId/download', async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const id = req.params.id;
  const fileId = req.params.fileId;

  try {
    if (!isUuid(id) || !isUuid(fileId)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id and file id must be UUIDs');
      return;
    }

    // The file must belong to the estimate in the URL. A missing file and a file of
    // another estimate look the same to the caller.
    const file = await findEstimateFile(id, fileId);

    if (!file) {
      logAdminAudit({
        action: 'file.access.attempt',
        result: 'not_found',
        http_status: 404,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        file_id: fileId,
        ip: req.ip
      });
      sendError(res, 404, 'FILE_NOT_FOUND', 'File not found');
      return;
    }

    const decision = decideFileDownload({
      enabled: config.fileDownloadEnabled,
      provider: downloadProvider,
      file
    });

    if (!decision.allowed) {
      logAdminAudit({
        action: 'file.access.attempt',
        result: 'denied',
        http_status: 403,
        error_code: decision.code,
        admin_id: admin.id,
        role: admin.role,
        estimate_id: id,
        file_id: fileId,
        ip: req.ip
      });
      sendError(res, 403, decision.code, 'File download is currently restricted');
      return;
    }

    // Reached only when the flag is on, a real provider exists and the file is
    // approved + scanned. None of that is true today.
    const issued = await downloadProvider.issue(id, file);

    logAdminAudit({
      action: 'file.access.attempt',
      result: 'success',
      http_status: 200,
      admin_id: admin.id,
      role: admin.role,
      estimate_id: id,
      file_id: fileId,
      ip: req.ip
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { url: issued.url, expires_in_seconds: issued.expiresInSeconds }
    });
  } catch (err) {
    logger.error('Admin file download error', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

export default router;
