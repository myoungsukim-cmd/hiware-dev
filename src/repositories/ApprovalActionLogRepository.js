import { getPool } from '../db/pool.js';

/**
 * approval_action_logs — QUEUED / PROCESSING / SUCCESS 등
 * hiware_request_json 에 apvUserPwd 넣지 말 것 (마스킹 후 저장)
 */
export class ApprovalActionLogRepository {
  async createQueued({ apvApltNo, approverId, slackUserId, actionType, actionComment, slackActionJobId }) {
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO approval_action_logs (
        apv_aplt_no, approver_id, slack_user_id, action_type,
        action_comment, process_status, slack_action_job_id
      ) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?)`,
      [apvApltNo, approverId ?? null, slackUserId, actionType, actionComment ?? null, slackActionJobId]
    );
    return result.insertId;
  }

  async markProcessing(logId) {
    const pool = getPool();
    await pool.query(
      `UPDATE approval_action_logs SET process_status = 'PROCESSING' WHERE id = ?`,
      [logId]
    );
  }

  async findByJobId(jobId) {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id FROM approval_action_logs WHERE slack_action_job_id = ? LIMIT 1`,
      [jobId]
    );
    return rows[0] || null;
  }

  async markProcessingByJobId(jobId) {
    const log = await this.findByJobId(jobId);
    if (log) await this.markProcessing(log.id);
  }

  async markFailedByJobId(jobId, processStatus, errorMessage) {
    const log = await this.findByJobId(jobId);
    if (log) await this.markFailed(log.id, processStatus, errorMessage);
  }

  async markSuccess(logId, { hiwareRequest, hiwareResponse, hiwareResultCode, hiwareResultMessage }) {
    const pool = getPool();
    await pool.query(
      `UPDATE approval_action_logs
       SET process_status = 'SUCCESS',
           hiware_request_json = ?,
           hiware_response_json = ?,
           hiware_result_code = ?,
           hiware_result_message = ?
       WHERE id = ?`,
      [
        hiwareRequest ? JSON.stringify(hiwareRequest) : null,
        hiwareResponse ? JSON.stringify(hiwareResponse) : null,
        hiwareResultCode ?? null,
        hiwareResultMessage ?? null,
        logId,
      ]
    );
  }

  async markSuccessByJobId(jobId, data) {
    const log = await this.findByJobId(jobId);
    if (log) await this.markSuccess(log.id, data);
  }

  async markFailed(logId, processStatus, errorMessage) {
    const pool = getPool();
    await pool.query(
      `UPDATE approval_action_logs
       SET process_status = ?, error_message = ?
       WHERE id = ?`,
      [processStatus, errorMessage?.slice(0, 4000) ?? null, logId]
    );
  }
}

export const approvalActionLogRepository = new ApprovalActionLogRepository();

/** @param {object} body batchApplyApv request body (pwd 제외) */
export function maskHiwareRequest(body) {
  if (!body) return body;
  const clone = structuredClone(body);
  if (Array.isArray(clone)) {
    return clone.map((item) => {
      const { apvUserPwd, ...rest } = item;
      return { ...rest, apvUserPwd: apvUserPwd ? '***' : undefined };
    });
  }
  const { apvUserPwd, ...rest } = clone;
  return { ...rest, apvUserPwd: apvUserPwd ? '***' : undefined };
}
