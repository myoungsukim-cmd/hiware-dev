import { approvalApproverRepository } from '../repositories/ApprovalApproverRepository.js';
import { slackActionJobRepository } from '../jobs/SlackActionJobRepository.js';
import {
  approvalActionLogRepository,
} from '../repositories/ApprovalActionLogRepository.js';
import { approvalService } from './ApprovalService.js';
import { logger } from '../lib/logger.js';

export class ApprovalActionService {
  async enqueueApprovalAction({
    jobType,
    idempotencyKey,
    apvApltNo,
    approverId,
    slackUserId,
    slackTeamId,
    slackViewId,
    slackViewHash,
    payload,
  }) {
    const jobId = await slackActionJobRepository.enqueue({
      jobType,
      idempotencyKey,
      apvApltNo,
      approverId,
      slackUserId,
      slackTeamId,
      slackViewId,
      slackViewHash,
      payload,
    });

    const logId = await approvalActionLogRepository.createQueued({
      apvApltNo,
      approverId,
      slackUserId,
      actionType: jobType === 'APPROVAL_REJECT' ? 'REJECT' : 'ASSENT',
      actionComment: payload?.comment,
      slackActionJobId: jobId,
    });

    return { jobId, logId };
  }

  async processJob(job) {
    logger.info('processing approval job', {
      jobId: job.id,
      type: job.job_type,
      apvApltNo: job.apv_aplt_no,
    });
    return approvalService.handleApprovalJob(job);
  }
}

export const approvalActionService = new ApprovalActionService();
