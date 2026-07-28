import { getPool } from '../db/pool.js';

export class SlackEventLogRepository {
  async insert({
    eventType,
    eventStatus,
    apvApltNo = null,
    approverId = null,
    slackUserId = null,
    slackChannelId = null,
    slackMessageTs = null,
    slackViewId = null,
    slackActionJobId = null,
    slackApiMethod = null,
    slackErrorCode = null,
    errorMessage = null,
    metadata = null,
  }) {
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO slack_event_logs (
        event_type, event_status, apv_aplt_no, approver_id,
        slack_user_id, slack_channel_id, slack_message_ts, slack_view_id,
        slack_action_job_id, slack_api_method, slack_error_code,
        error_message, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        eventStatus,
        apvApltNo,
        approverId,
        slackUserId,
        slackChannelId,
        slackMessageTs,
        slackViewId,
        slackActionJobId,
        slackApiMethod,
        slackErrorCode,
        errorMessage?.slice(0, 4000) ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    return result.insertId;
  }

  async countByStatus() {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT event_status, COUNT(*) AS cnt
       FROM slack_event_logs
       GROUP BY event_status
       ORDER BY cnt DESC`
    );
    return rows;
  }

  async findRecent({ limit = 20, eventStatus = null } = {}) {
    const pool = getPool();
    const params = [];
    let where = '';
    if (eventStatus) {
      where = 'WHERE event_status = ?';
      params.push(eventStatus);
    }
    params.push(limit);
    const [rows] = await pool.query(
      `SELECT id, event_type, event_status, apv_aplt_no, slack_user_id,
              slack_error_code, error_message, created_at
       FROM slack_event_logs
       ${where}
       ORDER BY id DESC
       LIMIT ?`,
      params
    );
    return rows;
  }
}

export const slackEventLogRepository = new SlackEventLogRepository();
