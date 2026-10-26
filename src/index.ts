import { config, productionWarnings } from './config/env';
import { consentWarnings } from './config/privacyConsent';
import logger from './utils/logger';
import { createApp } from './app';
import { initializeEmailWorker } from './services/emailWorker';
import { startCleanupSchedule } from './services/retentionService';
import { startKakaoWorker } from './services/kakaoService';

const app = createApp();

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${config.nodeEnv}`);
  console.log(`✓ CORS origins: ${config.corsOrigins.join(', ')}`);

  productionWarnings(config).forEach(warning => logger.warn(warning));
  consentWarnings(config.nodeEnv).forEach(warning => logger.warn(warning));

  // Initialize email worker (Phase 2 Day 3)
  if (config.nodeEnv !== 'test') {
    initializeEmailWorker();
    startKakaoWorker();
    if (process.env.CLEANUP_ENABLED !== 'false') {
      startCleanupSchedule();
    }
  }
});

export default app;
