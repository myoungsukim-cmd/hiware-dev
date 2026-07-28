import { config } from '../config/index.js';
import { TaskRejectedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Spring @EnableAsync + ThreadPoolTaskExecutor 대응
 */
export class AsyncExecutor {
  constructor({ corePoolSize, maxPoolSize, queueCapacity } = config.async) {
    this.corePoolSize = corePoolSize;
    this.maxPoolSize = maxPoolSize;
    this.queueCapacity = queueCapacity;
    this.activeCount = 0;
    this.queue = [];
  }

  run(task) {
    if (this.queue.length >= this.queueCapacity) {
      throw new TaskRejectedError(
        `queue full (capacity=${this.queueCapacity}, active=${this.activeCount})`
      );
    }
    this.queue.push(task);
    this.#drain();
  }

  #drain() {
    while (this.activeCount < this.maxPoolSize && this.queue.length > 0) {
      const task = this.queue.shift();
      this.activeCount += 1;
      Promise.resolve()
        .then(() => task())
        .catch((err) => logger.error('AsyncExecutor task failed', { error: err.message }))
        .finally(() => {
          this.activeCount -= 1;
          this.#drain();
        });
    }
  }

  getStats() {
    return {
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      corePoolSize: this.corePoolSize,
      maxPoolSize: this.maxPoolSize,
      queueCapacity: this.queueCapacity,
    };
  }
}

export const asyncExecutor = new AsyncExecutor();
