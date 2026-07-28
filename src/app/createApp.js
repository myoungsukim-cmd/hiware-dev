import express from 'express';
import { config } from '../config/index.js';
import healthRoutes from '../routes/health.routes.js';
import slackRoutes from '../routes/slack.routes.js';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler.js';

export function createApp() {
  const app = express();

  if (config.server.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRoutes);
  app.use('/slack', slackRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
