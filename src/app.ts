import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config, RateLimitSettings } from './config/env';
import logger from './utils/logger';
import { createRateLimiters } from './middleware/rateLimit';
import { assertFileDownloadConfiguration, downloadProvider } from './services/fileDownload';
import adminAuthRouter from './routes/adminAuth';
import { createAdminAccountRouter } from './routes/adminAccount';
import { createAdminEstimatesRouter } from './routes/adminEstimates';
import estimatesRouter from './routes/estimates';
import estimatePreviewRouter from './routes/estimatePreview';
import estimateImageAnalysisRouter from './routes/estimateImageAnalysis';

export interface CreateAppOptions {
  // Overrides for tests; production values come from the environment (see config/env.ts).
  rateLimits?: Partial<RateLimitSettings>;
  trustProxy?: number;
}

export function createApp(options: CreateAppOptions = {}): Express {
  assertFileDownloadConfiguration(config.fileDownloadEnabled, downloadProvider);

  const app: Express = express();

  // Number of reverse proxies in front of the app; decides which IP req.ip reports.
  app.set('trust proxy', options.trustProxy ?? config.trustProxy);

  app.disable('x-powered-by');
  app.use(helmet());

  // Responses that carry admin or customer data must not be stored by browsers or proxies.
  const noStore = (_req: Request, res: Response, next: NextFunction): void => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  app.use('/admin', noStore);
  app.use('/api', noStore);

  // Each app gets its own limiters (and in-memory counters).
  const limiters = createRateLimiters({ ...config.rateLimits, ...options.rateLimits });

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      // Without this a front end on another origin cannot read how long to wait after a 429.
      exposedHeaders: ['Retry-After', 'RateLimit', 'RateLimit-Policy']
    })
  );

  // Rate limits run before the body is parsed, so rejected requests cost almost nothing.
  app.use('/admin', limiters.api);
  app.post('/admin/login', limiters.login);

  // Public customer API: per IP, in process memory (see README, "Rate limiting"). These run
  // before the JSON parser and before the router that holds Multer, so a refused request is
  // never parsed and no file reaches S3.
  app.post('/api/estimates', limiters.estimateCreate);
  app.get('/api/estimates/:receipt_id', limiters.estimateRead);
  app.post('/api/estimate-preview', limiters.estimatePreview);
  // Before Multer in the router: a refused request never has its image parsed or sent on.
  app.post('/api/estimate-preview/analyze-image', limiters.imageAnalysis);

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
  app.use('/admin/me', createAdminAccountRouter({ passwordLimiter: limiters.password }));

  // Admin estimate management (Phase 3)
  app.use(
    '/admin/estimates',
    createAdminEstimatesRouter({ mutationLimiter: limiters.mutation })
  );

  // Customer API routes (Phase 2 Day 1)
  app.use('/api', estimatesRouter);
  app.use('/api', estimatePreviewRouter);
  app.use('/api', estimateImageAnalysisRouter);

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
