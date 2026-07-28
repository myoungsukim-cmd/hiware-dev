import { slackEventLogRepository } from '../repositories/SlackEventLogRepository.js';
import { logger } from '../lib/logger.js';

/**
 * Slack 연동 이벤트 감사 로그 — append-only
 * 실패해도 본 처리 흐름은 막지 않음
 */
export class SlackEventLogger {
  log(entry) {
    slackEventLogRepository.insert(entry).catch((err) => {
      logger.warn('slack event log write failed', {
        error: err.message,
        eventType: entry.eventType,
        apvApltNo: entry.apvApltNo,
      });
    });
  }

  logFromSlackApi({
    eventType,
    eventStatus,
    slackRes,
    slackApiMethod,
    errorMessage,
    ...context
  }) {
    this.log({
      ...context,
      eventType,
      eventStatus,
      slackApiMethod,
      slackErrorCode: slackRes?.error ?? null,
      errorMessage: errorMessage ?? (slackRes?.ok ? null : slackRes?.error),
    });
  }
}

export const slackEventLogger = new SlackEventLogger();
