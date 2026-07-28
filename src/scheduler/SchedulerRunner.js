import { acquireWorkerLock, releaseWorkerLock } from '../lib/WorkerLock.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import {
  hiwareUserSyncJob,
  slackUserMappingJob,
  hiwareApprovalSyncJob,
} from '../jobs/syncJobs.js';
import { slackApprovalNotifierJob } from '../jobs/SlackApprovalNotifierJob.js';
import { reminderJob } from '../jobs/ReminderJob.js';
import { staleApprovalReconcileJob } from '../jobs/StaleApprovalReconcileJob.js';

export class SchedulerRunner {
  constructor() {
    this.timers = [];
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule('userSync', config.scheduler.userSyncIntervalMs, async () => {
      if (!(await acquireWorkerLock('userSync', 600))) return;
      try {
        await hiwareUserSyncJob.run();
        await slackUserMappingJob.run();
      } finally {
        await releaseWorkerLock('userSync');
      }
    });
    this.#schedule('approvalSync', config.scheduler.approvalSyncIntervalMs, async () => {
      if (!(await acquireWorkerLock('approvalSync', 120))) return;
      try {
        await hiwareApprovalSyncJob.run();
        await slackApprovalNotifierJob.run();
      } finally {
        await releaseWorkerLock('approvalSync');
      }
    });
    this.#schedule('reminder', config.scheduler.reminderIntervalMs, async () => {
      if (!(await acquireWorkerLock('reminder', 120))) return;
      try {
        await reminderJob.run();
      } finally {
        await releaseWorkerLock('reminder');
      }
    });
    this.#schedule('reconcile', config.scheduler.reconcileIntervalMs, async () => {
      if (!(await acquireWorkerLock('reconcile', 600))) return;
      try {
        await staleApprovalReconcileJob.run();
      } finally {
        await releaseWorkerLock('reconcile');
      }
    });

    if (config.startup.runInitialSync) {
      setTimeout(() => this.#runInitialSync().catch((e) => logger.error('initial sync failed', { error: e.message })), 3000);
    }
    logger.info('SchedulerRunner started');
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  #schedule(name, intervalMs, fn) {
    const run = () => fn().catch((err) => logger.error(`scheduler ${name} error`, { error: err.message }));
    this.timers.push(setInterval(run, intervalMs));
  }

  async #runInitialSync() {
    logger.info('initial sync starting');
    await hiwareUserSyncJob.run();
    await slackUserMappingJob.run();
    await hiwareApprovalSyncJob.run();
    await slackApprovalNotifierJob.run();
    logger.info('initial sync done');
  }
}

export const schedulerRunner = new SchedulerRunner();
