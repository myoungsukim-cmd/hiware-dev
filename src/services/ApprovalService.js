import { hiwareClient } from '../clients/HiwareClient.js';
import { slackClient } from '../clients/SlackClient.js';
import { withTransaction } from '../db/pool.js';
import { approvalItemRepository } from '../repositories/ApprovalItemRepository.js';
import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import {
  approvalActionLogRepository,
  maskHiwareRequest,
} from '../repositories/ApprovalActionLogRepository.js';
import { slackMessageUpdater } from '../services/SlackMessageUpdater.js';
import { requesterNotifier } from '../services/RequesterNotifier.js';
import { approvalSyncService } from '../services/ApprovalSyncService.js';
import { config, needsApvUserPwd } from '../config/index.js';
import { buildCompletedModal, buildErrorModal } from '../slack/blockKit.js';
import { slackEventLogger } from './SlackEventLogger.js';
import { SLACK_EVENT, SLACK_EVENT_STATUS } from '../lib/slackEventTypes.js';

const HIWARE_SUCCESS = new Set(['00', '16']);
const HIWARE_DUPLICATE = new Set(['01', '03']);

export class ApprovalService {
  async handleApprovalJob(job) {
    const payload = typeof job.payload_json === 'string'
      ? JSON.parse(job.payload_json)
      : job.payload_json;

    const actionType = job.job_type === 'APPROVAL_REJECT' ? 'Reject' : 'Assent';
    const apvApplyType = actionType;

    return withTransaction(async (conn) => {
      const item = await approvalItemRepository.findByApvNoForUpdate(job.apv_aplt_no, conn);
      if (!item) {
        throw new Error(`결재 문서 없음: ${job.apv_aplt_no}`);
      }

      if (['APPROVED', 'REJECTED', 'CANCELED'].includes(item.status)) {
        await this.#failModal(job, '이미 처리된 결재입니다.');
        return { ok: false, duplicated: true };
      }

      const approver = await approvalApproverRepository.findForAction(
        job.slack_user_id,
        job.apv_aplt_no,
        item.current_step,
        conn
      );

      if (!approver) {
        await this.#failModal(job, '현재 결재 차례가 아닙니다.');
        return { ok: false, validation: true };
      }
      if (!['WAITING', 'NOTIFIED'].includes(approver.approver_status)) {
        await this.#failModal(job, '이미 처리된 요청입니다.');
        return { ok: false, duplicated: true };
      }

      const apvUserPwd = String(payload.apvUserPwd || '').trim();
      if (needsApvUserPwd() && !apvUserPwd) {
        await this.#failModal(job, 'HIWARE 비밀번호를 입력해 주세요.');
        return { ok: false, validation: true };
      }

      const hiwareBody = [{
        apvApltNo: job.apv_aplt_no,
        apvApplyType,
        apvComment: payload.comment,
        ...(apvUserPwd && (config.approval.requireApvUserPwd || config.approval.applyAsApprover)
          ? { apvUserPwd }
          : {}),
      }];

      let hiwareResult;
      try {
        if (config.approval.applyAsApprover) {
          const hiwareUserId = approver.hiware_user_id;
          if (!hiwareUserId) {
            await this.#failModal(job, '결재자 HIWARE 계정 매핑이 없습니다.');
            return { ok: false, validation: true };
          }
          hiwareResult = await hiwareClient.batchApplyApvAs({
            userId: hiwareUserId,
            password: apvUserPwd,
            items: hiwareBody,
          });
        } else {
          hiwareResult = await hiwareClient.batchApplyApv(hiwareBody);
        }
      } catch (err) {
        await approvalApproverRepository.updateStatus(approver.id, { approver_status: 'ERROR' }, conn);
        await this.#failModal(job, err.message || 'HIWARE 결재 처리 실패');
        throw err;
      }

      const firstItem = hiwareResult?.content?.[0];
      const resultCode = String(firstItem?.apvApltResultCode ?? '');

      if (HIWARE_DUPLICATE.has(resultCode)) {
        await this.#failModal(job, firstItem?.apvApltResultCodeNm || '이미 처리된 결재입니다.');
        return { ok: false, duplicated: true };
      }
      if (!HIWARE_SUCCESS.has(resultCode)) {
        await approvalApproverRepository.updateStatus(approver.id, { approver_status: 'ERROR' }, conn);
        await this.#failModal(job, firstItem?.apvApltResultCodeNm || 'HIWARE 결재 처리 실패');
        throw new Error(firstItem?.apvApltResultCodeNm || 'HIWARE error');
      }

      const now = new Date();
      const isFinal = actionType === 'Reject'
        || await approvalSyncService.isApprovalFinal(
          job.apv_aplt_no,
          firstItem?.apvApltResultCodeNm || ''
        );

      if (actionType === 'Reject') {
        await approvalApproverRepository.updateStatus(approver.id, {
          approver_status: 'REJECTED',
          action_type: 'REJECT',
          action_comment: payload.comment,
          acted_at: now,
        }, conn);
        await approvalApproverRepository.skipAllPending(job.apv_aplt_no, approver.id, conn);
        await approvalItemRepository.updateStatus(job.apv_aplt_no, {
          status: 'REJECTED',
          completed_by_hiware_user_no: approver.hiware_user_no,
          completed_by_slack_user_id: job.slack_user_id,
          completed_action: 'REJECT',
          completed_comment: payload.comment,
          completed_at: now,
        }, conn);
      } else {
        await approvalApproverRepository.updateStatus(approver.id, {
          approver_status: 'APPROVED',
          action_type: 'ASSENT',
          action_comment: payload.comment,
          acted_at: now,
        }, conn);

        if (approver.approval_rule === 'ANY_ONE') {
          await approvalApproverRepository.skipOthersAtStep(job.apv_aplt_no, approver.approval_step, approver.id, conn);
        }

        if (isFinal) {
          await approvalItemRepository.updateStatus(job.apv_aplt_no, {
            status: 'APPROVED',
            completed_by_hiware_user_no: approver.hiware_user_no,
            completed_by_slack_user_id: job.slack_user_id,
            completed_action: 'ASSENT',
            completed_comment: payload.comment,
            completed_at: now,
          }, conn);
        } else {
          await approvalItemRepository.updateStatus(job.apv_aplt_no, { status: 'IN_PROGRESS' }, conn);
        }
      }

      const masked = maskHiwareRequest(hiwareBody.map((b) => ({ ...b, apvUserPwd: '***' })));
      await approvalActionLogRepository.markSuccessByJobId(job.id, {
        hiwareRequest: masked,
        hiwareResponse: hiwareResult,
        hiwareResultCode: resultCode,
        hiwareResultMessage: firstItem?.apvApltResultCodeNm,
      });

      const updatedItem = await approvalItemRepository.findByApvNo(job.apv_aplt_no, conn);
      const updatedActor = await approvalApproverRepository.findById(approver.id, conn);

      await slackMessageUpdater.updateSlackMessagesAfterAction({
        apvApltNo: job.apv_aplt_no,
        actorApproverId: approver.id,
        actionType,
        comment: payload.comment,
        item: updatedItem,
        actor: updatedActor,
      });

      if (['APPROVED', 'REJECTED'].includes(updatedItem.status)) {
        await requesterNotifier.notifyRequesterIfFinal(job.apv_aplt_no);
      }

      await this.#successModal(job, payload.actionLabel || (actionType === 'Reject' ? '반려' : '승인'));
      slackEventLogger.log({
        eventType: SLACK_EVENT.ACTION_QUEUED,
        eventStatus: SLACK_EVENT_STATUS.SUCCESS,
        apvApltNo: job.apv_aplt_no,
        approverId: job.approver_id,
        slackUserId: job.slack_user_id,
        slackActionJobId: job.id,
        metadata: { actionType, result: 'completed' },
      });
      return { ok: true, hiwareResult };
    });
  }

  async #successModal(job, actionLabel) {
    if (!job.slack_view_id) return;
    // API가 먼저 '처리 중'으로 update하면 job에 저장된 hash는 stale → hash 없이 강제 갱신
    const res = await slackClient.updateModal(job.slack_view_id, null, buildCompletedModal(actionLabel));
    slackEventLogger.logFromSlackApi({
      eventType: res?.ok ? SLACK_EVENT.MODAL_UPDATED : SLACK_EVENT.MODAL_UPDATE_FAILED,
      eventStatus: res?.ok ? SLACK_EVENT_STATUS.SUCCESS : SLACK_EVENT_STATUS.FAILED,
      slackRes: res,
      slackApiMethod: 'views.update',
      apvApltNo: job.apv_aplt_no,
      approverId: job.approver_id,
      slackUserId: job.slack_user_id,
      slackViewId: job.slack_view_id,
      slackActionJobId: job.id,
      metadata: { actionLabel, result: 'completed' },
    });
  }

  async #failModal(job, message) {
    if (!job.slack_view_id) return;
    const res = await slackClient.updateModal(job.slack_view_id, null, buildErrorModal(message));
    slackEventLogger.logFromSlackApi({
      eventType: res?.ok ? SLACK_EVENT.MODAL_UPDATED : SLACK_EVENT.MODAL_UPDATE_FAILED,
      eventStatus: SLACK_EVENT_STATUS.FAILED,
      slackRes: res,
      slackApiMethod: 'views.update',
      apvApltNo: job.apv_aplt_no,
      approverId: job.approver_id,
      slackUserId: job.slack_user_id,
      slackViewId: job.slack_view_id,
      slackActionJobId: job.id,
      errorMessage: message,
      metadata: { result: 'error_modal' },
    });
  }
}

export const approvalService = new ApprovalService();
