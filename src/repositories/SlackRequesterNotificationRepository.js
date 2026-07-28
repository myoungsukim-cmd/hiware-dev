import { getPool } from '../db/pool.js';

export class SlackRequesterNotificationRepository {
  async existsFinal(apvApltNo) {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id FROM slack_requester_notifications
       WHERE apv_aplt_no = ? AND notify_type IN ('FINAL_APPROVED','FINAL_REJECTED') LIMIT 1`,
      [apvApltNo]
    );
    return rows.length > 0;
  }

  async create(row) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO slack_requester_notifications (
        apv_aplt_no, hiware_user_no, slack_user_id, slack_channel_id,
        slack_message_ts, notify_type, message_status, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'SENT', NOW())`,
      [
        row.apv_aplt_no,
        row.hiware_user_no,
        row.slack_user_id,
        row.slack_channel_id,
        row.slack_message_ts,
        row.notify_type,
      ]
    );
  }
}

export const slackRequesterNotificationRepository = new SlackRequesterNotificationRepository();
