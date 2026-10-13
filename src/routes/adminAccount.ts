import { Router, Request, RequestHandler, Response } from 'express';
import { allowPasswordChangeRequired, authMiddleware } from '../middleware/auth';
import { parsePasswordChangeBody, requireJson, sendError } from '../middleware/adminValidation';
import { PasswordChangeError, changeOwnPassword } from '../services/adminAccountService';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_MIN_CHARACTER_TYPES
} from '../utils/passwordPolicy';
import { logAdminAudit } from '../utils/auditLog';
import logger from '../utils/logger';

const ERROR_RESPONSES: Record<PasswordChangeError, { http: number; message: string }> = {
  PASSWORD_TOO_LONG: {
    http: 400,
    message: `New password must be at most ${PASSWORD_MAX_BYTES} bytes in UTF-8`
  },
  PASSWORD_POLICY_VIOLATION: { http: 400, message: 'New password does not meet the password policy' },
  INVALID_CURRENT_PASSWORD: { http: 401, message: 'Current password is incorrect' },
  ACCOUNT_LOCKED: { http: 401, message: 'Account is locked. Try again later.' },
  ACCOUNT_UNAVAILABLE: { http: 401, message: 'Admin account is unavailable' },
  PASSWORD_SAME_AS_CURRENT: {
    http: 422,
    message: 'New password must be different from the current password'
  }
};

export interface AdminAccountRouterDeps {
  passwordLimiter?: RequestHandler;
}

export function createAdminAccountRouter(deps: AdminAccountRouterDeps = {}): Router {
  const router = Router();

  // allowPasswordChangeRequired: an account that must change its password may use this route.
  const guards: RequestHandler[] = [allowPasswordChangeRequired, authMiddleware];
  if (deps.passwordLimiter) {
    guards.push(deps.passwordLimiter);
  }
  guards.push(requireJson);

  router.patch('/password', ...guards, async (req: Request, res: Response): Promise<void> => {
    const admin = req.admin!;

    try {
      const body = parsePasswordChangeBody(req.body);
      if (!body.valid) {
        sendError(res, 400, 'VALIDATION_ERROR', body.message);
        return;
      }

      const outcome = await changeOwnPassword({
        adminId: admin.id,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword
      });

      if (!outcome.ok) {
        const response = ERROR_RESPONSES[outcome.error];

        logAdminAudit({
          action: 'admin.password.change',
          result: 'denied',
          http_status: response.http,
          error_code: outcome.error,
          admin_id: admin.id,
          role: admin.role,
          ip: req.ip
        });

        const details =
          outcome.error === 'PASSWORD_POLICY_VIOLATION'
            ? {
                violations: outcome.violations,
                min_characters: PASSWORD_MIN_CHARACTERS,
                max_bytes: PASSWORD_MAX_BYTES,
                min_character_types: PASSWORD_MIN_CHARACTER_TYPES
              }
            : outcome.error === 'PASSWORD_TOO_LONG'
              ? { max_bytes: PASSWORD_MAX_BYTES }
              : undefined;

        sendError(res, response.http, outcome.error, response.message, details);
        return;
      }

      // Every session of this admin was revoked, so the cookies are useless now.
      res.clearCookie('access_token', { path: '/admin' });
      res.clearCookie('refresh_token', { path: '/admin/token/refresh' });

      logAdminAudit({
        action: 'admin.password.change',
        result: 'success',
        http_status: 200,
        admin_id: admin.id,
        role: admin.role,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password changed. All sessions were signed out; please log in again.',
        data: { reauthentication_required: true }
      });
    } catch (err) {
      logger.error('Admin password change error', {
        error: err instanceof Error ? err.message : String(err)
      });
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  return router;
}
