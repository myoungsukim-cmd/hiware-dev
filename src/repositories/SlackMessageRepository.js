import { getPool } from '../db/pool.js';

export class SlackMessageRepository {
  async create({ apvApltNo, approverId, slackUserId, channelId, messageTs }) {
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO slack_messages (
        apv_aplt_no, approver_id, slack_user_id, slack_channel_id, slack_message_ts, message_status, sent_at
      ) VALUES (?, ?, ?, ?, ?, 'SENT', NOW())`,
      [apvApltNo, approverId, slackUserId, channelId, messageTs]
    );
    return result.insertId;
  }

  async updateStatus(id, status) {
    const pool = getPool();
    await pool.query(`UPDATE slack_messages SET message_status = ?, updated_at = NOW() WHERE id = ?`, [status, id]);
  }
}

export const slackMessageRepository = new SlackMessageRepository();
