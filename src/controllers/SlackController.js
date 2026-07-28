import { slackClient } from '../clients/SlackClient.js';
import { hiwareClient } from '../clients/HiwareClient.js';
import { approvalActionService } from '../services/ApprovalActionService.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { validateComment } from '../utils/commentValidator.js';
import {
  SLACK_ACTIONS,
  MODAL_CALLBACK_ID,
  buildApprovalDetailModal,
  buildLoadingDetailModal,
  buildProcessingModal,
  buildErrorModal,
  extractModalActionValues,
  mapHiwareApprovalDetail,
  parseSlackPayload,
} from '../slack/blockKit.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { TaskRejectedError } from '../lib/errors.js';
import { slackEventLogger } from '../services/SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

const JOB_TYPE_MAP = {
  [SLACK_ACTIONS.ASSENT]: 'APPROVAL_ASSENT',
  [SLACK_ACTIONS.REJECT]: 'APPROVAL_REJECT',
};

export class SlackController {
  async handleActions(req, res) {
    const payload = parseSlackPayload(req.body);
    if (!payload) {
      return res.status(400).json({ error: 'Invalid Slack payload' });
    }

    logger.debug('slack action', { type: payload.type, action: payload.actions?.[0]?.action_id });

    if (payload.type === 'block_actions') {
      return this.#handleBlockActions(payload, res);
    }

    return res.status(200).send('');
  }

  async #handleBlockActions(payload, res) {
    const action = payload.actions?.[0];
    if (!action) return res.status(200).send('');

    if (action.action_id === SLACK_ACTIONS.OPEN_MODAL) {
      return this.#openDetailModal(payload, action, res);
    }

    if (action.action_id === SLACK_ACTIONS.ASSENT || action.action_id === SLACK_ACTIONS.REJECT) {
      return this.#handleModalAction(payload, action, res);
    }

    return res.status(200).send('');
  }

  /**
   * DM [상세/처리하기]
   * 1) 로딩 Modal 즉시 views.open (trigger_id 3초 제한)
   * 2) HTTP 200 ack
   * 3) HIWARE 상세 조회 후 views.update
   */
  async #openDetailModal(payload, action, res) {
    const apvApltNo = action.value;
    if (!apvApltNo) return res.status(200).send('');

    const channelId = payload.channel?.id || '';
    const messageTs = payload.message?.ts || '';
    const slackUserId = payload.user?.id;
    const ctx = { channelId, messageTs, slackUserId };

    let modalRes;
    try {
      modalRes = await slackClient.openModal(
        payload.trigger_id,
        buildLoadingDetailModal(apvApltNo, ctx)
      );
      slackEventLogger.logFromSlackApi({
        eventType: modalRes?.ok ? SLACK_EVENT.MODAL_OPENED : SLACK_EVENT.MODAL_OPEN_FAILED,
        eventStatus: modalRes?.ok ? SLACK_EVENT_STATUS.SUCCESS : SLACK_EVENT_STATUS.FAILED,
        slackRes: modalRes,
        slackApiMethod: 'views.open',
        apvApltNo,
        slackUserId,
        slackChannelId: channelId,
        slackMessageTs: messageTs,
        metadata: { phase: 'loading' },
      });
    } catch (err) {
      logger.error('open loading modal failed', { apvApltNo, error: err.message });
      slackEventLogger.log({
        eventType: SLACK_EVENT.MODAL_OPEN_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId,
        slackApiMethod: 'views.open',
        errorMessage: err.message,
      });
      return res.status(200).send('');
    }

    // Slack Interactivity 3초 ack — HIWARE 조회 전에 응답
    res.status(200).send('');

    if (!modalRes?.ok || !modalRes?.view?.id) return;

    try {
      const raw = await hiwareClient.getApprovalDetail(apvApltNo);
      const detail = mapHiwareApprovalDetail(raw);
      if (!detail?.apvApltNo) {
        logger.warn('approval detail empty', { apvApltNo });
        await slackClient.updateModal(
          modalRes.view.id,
          modalRes.view.hash,
          buildErrorModal('결재 상세를 불러오지 못했습니다.')
        );
        return;
      }

      const updateRes = await slackClient.updateModal(
        modalRes.view.id,
        modalRes.view.hash,
        buildApprovalDetailModal(detail, ctx)
      );
      slackEventLogger.logFromSlackApi({
        eventType: updateRes?.ok ? SLACK_EVENT.MODAL_OPENED : SLACK_EVENT.MODAL_OPEN_FAILED,
        eventStatus: updateRes?.ok ? SLACK_EVENT_STATUS.SUCCESS : SLACK_EVENT_STATUS.FAILED,
        slackRes: updateRes,
        slackApiMethod: 'views.update',
        apvApltNo,
        slackUserId,
        slackChannelId: channelId,
        slackMessageTs: messageTs,
        slackViewId: modalRes.view.id,
        metadata: { phase: 'detail' },
      });
    } catch (err) {
      logger.error('fill detail modal failed', { apvApltNo, error: err.message });
      try {
        await slackClient.updateModal(
          modalRes.view.id,
          modalRes.view.hash,
          buildErrorModal('결재 상세 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        );
      } catch (updateErr) {
        logger.error('error modal update failed', { apvApltNo, error: updateErr.message });
      }
      slackEventLogger.log({
        eventType: SLACK_EVENT.MODAL_OPEN_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId,
        slackViewId: modalRes.view.id,
        slackApiMethod: 'views.update',
        errorMessage: err.message,
      });
    }
  }

  /** Modal 내 [승인]/[반려] 버튼 */
  async #handleModalAction(payload, action, res) {
    const view = payload.view;
    if (view?.callback_id !== MODAL_CALLBACK_ID) {
      return res.status(200).send('');
    }

    const data = extractModalActionValues(view);
    const apvApltNo = action.value || data.apvApltNo;
    const commentCheck = validateComment(data.comment);

    if (!commentCheck.ok) {
      await slackClient.updateModal(view.id, view.hash, buildErrorModal(commentCheck.message));
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_VALIDATION_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId: payload.user?.id,
        slackViewId: view.id,
        errorMessage: commentCheck.message,
        metadata: { field: 'comment' },
      });
      return res.status(200).send('');
    }
    if (config.approval.requireApvUserPwd && !data.apvUserPwd?.trim()) {
      await slackClient.updateModal(view.id, view.hash, buildErrorModal('HIWARE 결재 비밀번호를 입력해 주세요.'));
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_VALIDATION_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId: payload.user?.id,
        slackViewId: view.id,
        errorMessage: 'HIWARE 결재 비밀번호를 입력해 주세요.',
        metadata: { field: 'apvUserPwd' },
      });
      return res.status(200).send('');
    }

    const jobType = JOB_TYPE_MAP[action.action_id];
    const actionLabel = action.action_id === SLACK_ACTIONS.REJECT ? '반려' : '승인';

    const item = await approvalItemRepository.findByApvNo(apvApltNo);
    if (item && ['APPROVED', 'REJECTED', 'CANCELED'].includes(item.status)) {
      await slackClient.updateModal(view.id, view.hash, buildErrorModal('이미 처리된 결재입니다.'));
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_VALIDATION_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId: payload.user?.id,
        slackViewId: view.id,
        errorMessage: '이미 처리된 결재입니다.',
      });
      return res.status(200).send('');
    }

    const approver = await approvalApproverRepository.findBySlackUserAndApv(payload.user?.id, apvApltNo);
    if (!approver) {
      await slackClient.updateModal(view.id, view.hash, buildErrorModal('현재 결재 차례가 아닙니다.'));
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_VALIDATION_FAILED,
        eventStatus: SLACK_EVENT_STATUS.FAILED,
        apvApltNo,
        slackUserId: payload.user?.id,
        slackViewId: view.id,
        errorMessage: '현재 결재 차례가 아닙니다.',
      });
      return res.status(200).send('');
    }

    const idempotencyKey = [payload.user?.id, apvApltNo, jobType, view.id].join(':');

    try {
      const { jobId } = await approvalActionService.enqueueApprovalAction({
        jobType,
        idempotencyKey,
        apvApltNo,
        approverId: approver.id,
        slackUserId: payload.user?.id,
        slackTeamId: payload.team?.id,
        slackViewId: view.id,
        slackViewHash: view.hash,
        payload: {
          comment: commentCheck.value,
          ...(config.approval.requireApvUserPwd ? { apvUserPwd: data.apvUserPwd } : {}),
          channelId: data.channelId,
          messageTs: data.messageTs,
          actionLabel,
        },
      });

      await slackClient.updateModal(view.id, view.hash, buildProcessingModal());
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_QUEUED,
        eventStatus: SLACK_EVENT_STATUS.PENDING,
        apvApltNo,
        approverId: approver.id,
        slackUserId: payload.user?.id,
        slackViewId: view.id,
        slackActionJobId: jobId,
        slackApiMethod: 'views.update',
        metadata: { jobType, actionLabel },
      });
    } catch (err) {
      if (err instanceof TaskRejectedError) {
        await slackClient.updateModal(view.id, view.hash, buildErrorModal('서버가 바쁩니다. 잠시 후 다시 시도해 주세요.'));
        slackEventLogger.log({
          eventType: SLACK_EVENT.ACTION_VALIDATION_FAILED,
          eventStatus: SLACK_EVENT_STATUS.FAILED,
          apvApltNo,
          approverId: approver.id,
          slackUserId: payload.user?.id,
          slackViewId: view.id,
          errorMessage: '서버가 바쁩니다. 잠시 후 다시 시도해 주세요.',
        });
        return res.status(200).send('');
      }
      throw err;
    }

    return res.status(200).send('');
  }
}

export const slackController = new SlackController();
