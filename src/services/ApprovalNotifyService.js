import { slackClient } from '../clients/SlackClient.js';
import { buildApprovalDm } from '../slack/blockKit.js';
import { logger } from '../lib/logger.js';
import { slackEventLogger } from './SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

/**
 * 결재자 DM 발송 — Block Kit은 백엔드에서 생성, Slack App은 봇 토큰만 있으면 됨
 */
export class ApprovalNotifyService {
  async openDmChannel(slackUserId) {
    const res = await slackClient.openConversation(slackUserId);
    return res?.channel?.id || slackUserId;
  }

  async sendApprovalDm(slackUserId, detail) {
    const channel = await this.openDmChannel(slackUserId);
    const message = buildApprovalDm({ detail });
    const res = await slackClient.postMessage(channel, message.blocks, message.text);
    if (!res?.ok) {
      logger.error('approval DM send failed', { slackUserId, apvApltNo: detail.apvApltNo });
      slackEventLogger.logFromSlackApi({
        eventType: SLACK_EVENT.DM_SEND_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        slackRes: res,
        slackApiMethod: 'chat.postMessage',
        apvApltNo: detail.apvApltNo,
        slackUserId,
        slackChannelId: channel,
        errorMessage: res?.error || 'DM send failed',
      });
      return null;
    }
    slackEventLogger.logFromSlackApi({
      eventType: SLACK_EVENT.DM_SENT,
      eventStatus: SLACK_EVENT_STATUS.SUCCESS,
      slackRes: res,
      slackApiMethod: 'chat.postMessage',
      apvApltNo: detail.apvApltNo,
      slackUserId,
      slackChannelId: res.channel,
      slackMessageTs: res.ts,
    });
    return {
      channelId: res.channel,
      messageTs: res.ts,
      slackUserId,
    };
  }
}

export const approvalNotifyService = new ApprovalNotifyService();
