import { Router, Request, Response } from 'express';
import { isUuid, requireJson, sendError } from '../middleware/adminValidation';
import { InquiryError, answerQuestion, completeConsultation, listInquiries } from '../services/quoteInquiryService';
import { parseAnswer, parseDoneNote } from '../utils/quoteInquiry';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

// Mounted under /admin/estimates/:id/inquiries, behind the authentication, the role check and the rate
// limit of the parent router: what the customer asked about the quote, and the staff's answers.
const router = Router({ mergeParams: true });

const MESSAGES: Record<string, { http: number; message: string }> = {
  INQUIRY_NOT_FOUND: { http: 404, message: 'Inquiry not found' },
  WRONG_KIND: { http: 409, message: 'This inquiry is of the other kind' },
  ALREADY_HANDLED: { http: 409, message: 'This inquiry has already been handled' }
};

type Base = { admin_id: string; role: string; estimate_id: string; inquiry_id?: string; ip?: string };

function answerError(res: Response, err: unknown, action: string, base: Base): void {
  if (err instanceof InquiryError && MESSAGES[err.code]) {
    const mapped = MESSAGES[err.code];
    logAdminAudit({ action, result: 'denied', http_status: mapped.http, error_code: err.code, ...base });
    sendError(res, mapped.http, err.code, mapped.message);
    return;
  }
  logger.error('Admin inquiry error', { action, error: err instanceof Error ? err.message : String(err) });
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;
  try {
    if (!isUuid(id)) {
      sendError(res, 400, 'INVALID_ID', 'Estimate id must be a UUID');
      return;
    }
    const items = await listInquiries(id);
    if (!items) {
      sendError(res, 404, 'ESTIMATE_NOT_FOUND', 'Estimate not found');
      return;
    }
    res.json({ success: true, data: items });
  } catch (err) {
    answerError(res, err, 'inquiry.read', { admin_id: req.admin!.id, role: req.admin!.role, estimate_id: String(id), ip: req.ip });
  }
});

// Answers a question in writing. The handler is the admin of the session, never a value of the body.
router.post('/:inquiryId/answer', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const { id, inquiryId } = req.params;
  const base: Base = { admin_id: admin.id, role: admin.role, estimate_id: String(id), inquiry_id: String(inquiryId), ip: req.ip };
  try {
    if (!isUuid(id) || !isUuid(inquiryId)) {
      sendError(res, 400, 'INVALID_ID', 'Ids must be UUIDs');
      return;
    }
    const parsed = parseAnswer(req.body);
    if (!parsed.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid answer', parsed.errors);
      return;
    }
    const inquiry = await answerQuestion(id, inquiryId, admin.id, parsed.value);
    logAdminAudit({ action: 'inquiry.answer', result: 'success', http_status: 200, ...base });
    res.json({ success: true, data: inquiry });
  } catch (err) {
    answerError(res, err, 'inquiry.answer', base);
  }
});

// The staff phoned the customer: the request for a consultation is done.
router.post('/:inquiryId/done', requireJson, async (req: Request, res: Response): Promise<void> => {
  const admin = req.admin!;
  const { id, inquiryId } = req.params;
  const base: Base = { admin_id: admin.id, role: admin.role, estimate_id: String(id), inquiry_id: String(inquiryId), ip: req.ip };
  try {
    if (!isUuid(id) || !isUuid(inquiryId)) {
      sendError(res, 400, 'INVALID_ID', 'Ids must be UUIDs');
      return;
    }
    const parsed = parseDoneNote(req.body);
    if (!parsed.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid note', parsed.errors);
      return;
    }
    const inquiry = await completeConsultation(id, inquiryId, admin.id, parsed.value);
    logAdminAudit({ action: 'inquiry.done', result: 'success', http_status: 200, ...base });
    res.json({ success: true, data: inquiry });
  } catch (err) {
    answerError(res, err, 'inquiry.done', base);
  }
});

export default router;
