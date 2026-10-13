import { config } from './config/env';
import { createApp } from './app';
import { initializeEmailWorker } from './services/emailWorker';

const app = createApp();

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${config.nodeEnv}`);
  console.log(`✓ CORS origins: ${config.corsOrigins.join(', ')}`);

  // Initialize email worker (Phase 2 Day 3)
  if (config.nodeEnv !== 'test') {
    initializeEmailWorker();
  }
});

export default app;
