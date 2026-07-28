import { slackClient } from '../clients/SlackClient.js';
import { hiwareClient } from '../clients/HiwareClient.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { slackMessageRepository } from '../repositories/SlackMessageRepository.js';
import { approvalNotifyService } from '../services/ApprovalNotifyService.js';
import { mapHiwareApprovalDetail } from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';
import { slackEventLogger } from '../services/SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

export class SlackApprovalNotifierJob {
  async run() {
    const pending = await approvalApproverRepository.findNeedingNotification();
    let sent = 0;
    for (const approver of pending) {
      try {
        const raw = await hiwareClient.getApprovalDetail(approver.apv_aplt_no);
        const detail = mapHiwareApprovalDetail(raw);
        if (!detail?.apvApltNo) continue;
        detail.apvReqUserInfo = detail.apvReqUserInfo || approver.hiware_user_name;

        const result = await approvalNotifyService.sendApprovalDm(approver.slack_user_id, detail);
        if (!result) continue;

        await slackMessageRepository.create({
          apvApltNo: approver.apv_aplt_no,
          approverId: approver.id,
          slackUserId: approver.slack_user_id,
          channelId: result.channelId,
          messageTs: result.messageTs,
        });
        await approvalApproverRepository.markNotified(approver.id);
        sent += 1;
      } catch (err) {
        logger.error('notifier failed', { approverId: approver.id, error: err.message });
        slackEventLogger.log({
          eventType: SLACK_EVENT.DM_SEND_FAILED,
          eventStatus: SLACK_EVENT_STATUS.FAILED,
          apvApltNo: approver.apv_aplt_no,
          approverId: approver.id,
          slackUserId: approver.slack_user_id,
          errorMessage: err.message,
          metadata: { source: 'SlackApprovalNotifierJob' },
        });
      }
    }
    logger.info('SlackApprovalNotifierJob done', { pending: pending.length, sent });
    return sent;
  }
}

export const slackApprovalNotifierJob = new SlackApprovalNotifierJob();
