import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import logger from './utils/logger';
import { assertFileDownloadConfiguration, downloadProvider } from './services/fileDownload';
import adminAuthRouter from './routes/adminAuth';
import { createAdminAccountRouter } from './routes/adminAccount';
import { createAdminEstimatesRouter } from './routes/adminEstimates';
import estimatesRouter from './routes/estimates';

export function createApp(): Express {
  assertFileDownloadConfiguration(config.fileDownloadEnabled, downloadProvider);

  const app: Express = express();

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv
    });
  });

  // Admin authentication routes (Day 3)
  app.use('/admin', adminAuthRouter);

  // Admin account (Phase 3 Week 2): own password change
  app.use('/admin/me', createAdminAccountRouter());

  // Admin estimate management (Phase 3)
  app.use('/admin/estimates', createAdminEstimatesRouter());

  // Customer API routes (Phase 2 Day 1)
  app.use('/api', estimatesRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({
        error: 'Invalid JSON body',
        code: 'INVALID_JSON',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (err instanceof Error) {
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
    } else {
      logger.error('Unhandled error', { error: String(err) });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      timestamp: new Date().toISOString()
    });
  });

  return app;
}
