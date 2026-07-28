import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { slackActionJobRepository } from '../jobs/SlackActionJobRepository.js';
import { approvalActionService } from '../services/ApprovalActionService.js';
import { approvalActionLogRepository } from '../repositories/ApprovalActionLogRepository.js';

/**
 * slack_action_jobs 폴링 Worker
 * - API 프로세스와 분리 실행 권장 (api + worker 2 프로세스)
 * - HIWARE/Slack 외부 API는 여기서 처리 → Slack 3초 제한 무관
 */
export class SlackActionJobWorker {
  constructor({ pollIntervalMs = config.worker.pollIntervalMs } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    logger.info('worker started', { pollIntervalMs: this.pollIntervalMs });
    this.#tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    logger.info('worker stopped');
  }

  #tick() {
    if (!this.running) return;
    this.#pollOnce()
      .catch((err) => logger.error('worker poll error', { error: err.message }))
      .finally(() => {
        this.timer = setTimeout(() => this.#tick(), this.pollIntervalMs);
      });
  }

  async #pollOnce() {
    const jobs = await slackActionJobRepository.claimBatch();
    if (jobs.length === 0) return;

    for (const job of jobs) {
      try {
        await approvalActionLogRepository.markProcessingByJobId(job.id);
        const result = await approvalActionService.processJob(job);
        await slackActionJobRepository.complete(job.id, result);
      } catch (err) {
        const requeue = job.attempts < job.max_attempts;
        await slackActionJobRepository.fail(job.id, err.message, requeue);
        await approvalActionLogRepository.markFailedByJobId(
          job.id,
          requeue ? 'RETRYING' : 'FAILED',
          err.message
        );
        logger.error('worker job failed', { jobId: job.id, requeue, error: err.message });
      }
    }
  }
}

export const slackActionJobWorker = new SlackActionJobWorker();
