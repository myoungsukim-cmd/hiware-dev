import { config } from '../config/index.js';
import { slackClient } from '../clients/SlackClient.js';
import { hiwareClient } from '../clients/HiwareClient.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { buildReminderDmBlocks } from '../slack/blockKit.js';
import { mapHiwareApprovalDetail } from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';
import { slackEventLogger } from '../services/SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

export class ReminderJob {
  async run() {
    const due = await approvalApproverRepository.findDueForReminder({
      firstDelayMin: config.reminder.firstDelayMin,
      intervalMin: config.reminder.intervalMin,
      maxCount: config.reminder.maxCount,
    });
    let sent = 0;
    for (const row of due) {
      try {
        const raw = await hiwareClient.getApprovalDetail(row.apv_aplt_no);
        const detail = mapHiwareApprovalDetail(raw);
        if (!detail) continue;
        const blocks = buildReminderDmBlocks({ detail, reminderNo: row.reminder_count + 1 });
        await slackClient.updateMessage(
          row.slack_channel_id,
          row.slack_message_ts,
          blocks,
          `[리마인더] 결재 요청: ${detail.apvTitle}`
        );
        await approvalApproverRepository.markReminded(row.id);
        slackEventLogger.log({
          eventType: SLACK_EVENT.DM_REMINDER,
          eventStatus: SLACK_EVENT_STATUS.SUCCESS,
          apvApltNo: row.apv_aplt_no,
          approverId: row.id,
          slackUserId: row.slack_user_id,
          slackChannelId: row.slack_channel_id,
          slackMessageTs: row.slack_message_ts,
          slackApiMethod: 'chat.update',
          metadata: { reminderNo: row.reminder_count + 1 },
        });
        sent += 1;
      } catch (err) {
        logger.error('reminder failed', { approverId: row.id, error: err.message });
        slackEventLogger.log({
          eventType: SLACK_EVENT.DM_REMINDER_FAILED,
          eventStatus: SLACK_EVENT_STATUS.FAILED,
          apvApltNo: row.apv_aplt_no,
          approverId: row.id,
          slackUserId: row.slack_user_id,
          slackChannelId: row.slack_channel_id,
          slackMessageTs: row.slack_message_ts,
          slackApiMethod: 'chat.update',
          errorMessage: err.message,
        });
      }
    }
    logger.info('ReminderJob done', { due: due.length, sent });
    return sent;
  }
}

export const reminderJob = new ReminderJob();
