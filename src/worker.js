import { config, validateWorkerConfig } from './config/index.js';
import { logger } from './lib/logger.js';
import { getPool } from './db/pool.js';
import { slackActionJobWorker } from './jobs/SlackActionJobWorker.js';
import { schedulerRunner } from './scheduler/SchedulerRunner.js';

validateWorkerConfig();
slackActionJobWorker.start();
schedulerRunner.start();

function shutdown(signal) {
  logger.info('worker shutdown', { signal });
  schedulerRunner.stop();
  slackActionJobWorker.stop();
  getPool()
    .end()
    .catch((err) => logger.error('pool close error', { error: err.message }))
    .finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
