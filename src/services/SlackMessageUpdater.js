import { slackClient } from '../clients/SlackClient.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { slackMessageRepository } from '../repositories/SlackMessageRepository.js';
import {
  buildCompletedDmBlocks,
  buildSkippedByOtherDmBlocks,
  buildClosedRejectedDmBlocks,
} from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';

import { formatNowKst } from '../lib/format.js';
import { slackEventLogger } from './SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

export class SlackMessageUpdater {
  async updateSlackMessagesAfterAction({ apvApltNo, actorApproverId, actionType, comment, item, actor }) {
    const rows = await approvalApproverRepository.findWithMessages(apvApltNo);
    const processedAt = formatNowKst();
    const resultLabel = actionType === 'Assent' ? '승인' : '반려';
    const actorName = actor?.hiware_user_name || '결재자';
    const title = item?.apv_title || apvApltNo;

    for (const row of rows) {
      try {
        if (row.approver_id === actorApproverId) {
          const blocks = buildCompletedDmBlocks({
            title,
            actorName,
            resultLabel,
            comment,
            processedAt,
          });
          await slackClient.updateMessage(row.slack_channel_id, row.slack_message_ts, blocks, `[결재 처리 완료] ${title}`);
          await slackMessageRepository.updateStatus(row.id, 'COMPLETED');
          slackEventLogger.log({
            eventType: SLACK_EVENT.DM_UPDATED,
            eventStatus: SLACK_EVENT_STATUS.SUCCESS,
            apvApltNo,
            approverId: row.approver_id,
            slackUserId: row.slack_user_id,
            slackChannelId: row.slack_channel_id,
            slackMessageTs: row.slack_message_ts,
            slackApiMethod: 'chat.update',
            metadata: { messageStatus: 'COMPLETED', resultLabel },
          });
          continue;
        }

        if (actionType === 'Reject' && ['WAITING', 'NOTIFIED', 'SKIPPED'].includes(row.approver_status)) {
          const blocks = buildClosedRejectedDmBlocks({ title, actorName, processedAt });
          await slackClient.updateMessage(row.slack_channel_id, row.slack_message_ts, blocks, `[결재 종료] ${title}`);
          await slackMessageRepository.updateStatus(row.id, 'SKIPPED');
          slackEventLogger.log({
            eventType: SLACK_EVENT.DM_UPDATED,
            eventStatus: SLACK_EVENT_STATUS.SUCCESS,
            apvApltNo,
            approverId: row.approver_id,
            slackUserId: row.slack_user_id,
            slackChannelId: row.slack_channel_id,
            slackMessageTs: row.slack_message_ts,
            slackApiMethod: 'chat.update',
            metadata: { messageStatus: 'SKIPPED', reason: 'rejected' },
          });
          continue;
        }

        if (
          actionType === 'Assent'
          && row.approval_step === actor.approval_step
          && row.approval_rule === 'ANY_ONE'
          && row.approver_status === 'SKIPPED'
        ) {
          const blocks = buildSkippedByOtherDmBlocks({ title, actorName, resultLabel, processedAt });
          await slackClient.updateMessage(row.slack_channel_id, row.slack_message_ts, blocks, `[결재 처리 완료] ${title}`);
          await slackMessageRepository.updateStatus(row.id, 'SKIPPED');
          slackEventLogger.log({
            eventType: SLACK_EVENT.DM_UPDATED,
            eventStatus: SLACK_EVENT_STATUS.SUCCESS,
            apvApltNo,
            approverId: row.approver_id,
            slackUserId: row.slack_user_id,
            slackChannelId: row.slack_channel_id,
            slackMessageTs: row.slack_message_ts,
            slackApiMethod: 'chat.update',
            metadata: { messageStatus: 'SKIPPED', reason: 'any_one_other' },
          });
        }
      } catch (err) {
        logger.error('chat.update failed', { messageId: row.id, error: err.message });
        await slackMessageRepository.updateStatus(row.id, 'FAILED');
        slackEventLogger.log({
          eventType: SLACK_EVENT.DM_UPDATE_FAILED,
          eventStatus: SLACK_EVENT_STATUS.FAILED,
          apvApltNo,
          approverId: row.approver_id,
          slackUserId: row.slack_user_id,
          slackChannelId: row.slack_channel_id,
          slackMessageTs: row.slack_message_ts,
          slackApiMethod: 'chat.update',
          errorMessage: err.message,
        });
      }
    }
  }
}

export const slackMessageUpdater = new SlackMessageUpdater();
