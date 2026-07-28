import { slackClient } from '../clients/SlackClient.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { slackUserMappingRepository } from '../repositories/SlackUserMappingRepository.js';
import { slackRequesterNotificationRepository } from '../repositories/SlackRequesterNotificationRepository.js';
import { buildRequesterFinalDmBlocks } from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';

import { formatNowKst } from '../lib/format.js';
import { slackEventLogger } from './SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

export class RequesterNotifier {
  async notifyRequesterIfFinal(apvApltNo) {
    const item = await approvalItemRepository.findByApvNo(apvApltNo);
    if (!item || !['APPROVED', 'REJECTED'].includes(item.status)) return false;
    if (await slackRequesterNotificationRepository.existsFinal(apvApltNo)) return false;

    const mapping = await slackUserMappingRepository.findByHiwareUserNo(item.apv_req_user_no);
    if (!mapping) {
      await approvalItemRepository.updateStatus(apvApltNo, { requester_notify_status: 'SKIPPED_NO_MAPPING' });
      slackEventLogger.log({
        eventType: SLACK_EVENT.REQUESTER_DM_SKIPPED,
        eventStatus: SLACK_EVENT_STATUS.SKIPPED,
        apvApltNo,
        metadata: { reason: 'no_slack_mapping', hiwareUserNo: item.apv_req_user_no },
      });
      return false;
    }

    const notifyType = item.status === 'APPROVED' ? 'FINAL_APPROVED' : 'FINAL_REJECTED';
    const actor = await approvalApproverRepository.findLatestActor(apvApltNo);
    const processedAt = formatNowKst();
    const blocks = buildRequesterFinalDmBlocks({
      title: item.apv_title,
      requesterName: item.apv_req_user_name,
      notifyType,
      actorName: actor?.hiware_user_name || '-',
      processedAt,
      comment: actor?.action_comment,
    });

    const channelRes = await slackClient.openConversation(mapping.slack_user_id);
    const channel = channelRes?.channel?.id || mapping.slack_user_id;
    const res = await slackClient.postMessage(
      channel,
      blocks,
      notifyType === 'FINAL_APPROVED' ? `[결재 최종 승인] ${item.apv_title}` : `[결재 반려] ${item.apv_title}`
    );
    if (!res?.ok) {
      logger.error('requester notify failed', { apvApltNo, error: res?.error });
      slackEventLogger.logFromSlackApi({
        eventType: SLACK_EVENT.REQUESTER_DM_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        slackRes: res,
        slackApiMethod: 'chat.postMessage',
        apvApltNo,
        slackUserId: mapping.slack_user_id,
        slackChannelId: channel,
        metadata: { notifyType },
      });
      return false;
    }

    slackEventLogger.logFromSlackApi({
      eventType: SLACK_EVENT.REQUESTER_DM_SENT,
      eventStatus: SLACK_EVENT_STATUS.SUCCESS,
      slackRes: res,
      slackApiMethod: 'chat.postMessage',
      apvApltNo,
      slackUserId: mapping.slack_user_id,
      slackChannelId: res.channel,
      slackMessageTs: res.ts,
      metadata: { notifyType },
    });

    await slackRequesterNotificationRepository.create({
      apv_aplt_no: apvApltNo,
      hiware_user_no: item.apv_req_user_no,
      slack_user_id: mapping.slack_user_id,
      slack_channel_id: res.channel,
      slack_message_ts: res.ts,
      notify_type: notifyType,
    });
    await approvalItemRepository.updateStatus(apvApltNo, {
      requester_notify_status: 'NOTIFIED',
      requester_notified_at: new Date(),
    });
    return true;
  }
}

export const requesterNotifier = new RequesterNotifier();
