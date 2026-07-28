import { createApp } from './app/createApp.js';
import { config, validateApiConfig } from './config/index.js';
import { logger } from './lib/logger.js';
import { getPool } from './db/pool.js';

validateApiConfig();

const app = createApp();
const { host, port } = config.server;

const server = app.listen(port, host, () => {
  logger.info('API server started', { host, port, nodeEnv: config.nodeEnv });
});

function shutdown(signal) {
  logger.info('shutdown signal', { signal });
  server.close(async () => {
    try {
      const pool = getPool();
      await pool.end();
    } catch (err) {
      logger.error('pool close error', { error: err.message });
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
