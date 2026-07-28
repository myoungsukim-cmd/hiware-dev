import { slackClient } from '../clients/SlackClient.js';
import { asyncExecutor } from '../lib/AsyncExecutor.js';
import { TaskRejectedError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export class AlertService {
  async sendMessage(message) {
    if (!message?.channel) {
      logger.debug('AlertService skip — no channel', { type: message?.type });
      return;
    }
    await slackClient.postMessage(message.channel, message.blocks, message.text);
  }

  sendMessageAsync(message) {
    asyncExecutor.run(() => this.sendMessage(message));
  }
}

export const alertService = new AlertService();

export function safeSendAlert(message) {
  try {
    alertService.sendMessageAsync(message);
  } catch (err) {
    if (err instanceof TaskRejectedError) {
      logger.warn('alert queue full', { type: message?.type });
      return;
    }
    throw err;
  }
}
