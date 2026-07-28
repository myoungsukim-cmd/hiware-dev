import { getPool } from '../db/pool.js';

export class SlackUserMappingRepository {
  async upsertMapped(row) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO slack_user_mappings (
        hiware_user_no, hiware_user_id, hiware_user_name, email_addr,
        slack_team_id, slack_user_id, slack_dm_channel_id, mapping_status, last_lookup_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MAPPED', NOW())
      ON DUPLICATE KEY UPDATE
        hiware_user_id = VALUES(hiware_user_id),
        hiware_user_name = VALUES(hiware_user_name),
        email_addr = VALUES(email_addr),
        slack_team_id = VALUES(slack_team_id),
        slack_user_id = VALUES(slack_user_id),
        slack_dm_channel_id = COALESCE(VALUES(slack_dm_channel_id), slack_dm_channel_id),
        mapping_status = 'MAPPED',
        last_lookup_at = NOW(),
        error_message = NULL`,
      [
        row.hiware_user_no,
        row.hiware_user_id ?? null,
        row.hiware_user_name ?? null,
        row.email_addr,
        row.slack_team_id ?? null,
        row.slack_user_id,
        row.slack_dm_channel_id ?? null,
      ]
    );
  }

  async upsertNotFound(row, errorMessage) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO slack_user_mappings (
        hiware_user_no, hiware_user_id, hiware_user_name, email_addr,
        slack_user_id, mapping_status, last_lookup_at, error_message
      ) VALUES (?, ?, ?, ?, ?, 'SLACK_NOT_FOUND', NOW(), ?)
      ON DUPLICATE KEY UPDATE
        mapping_status = 'SLACK_NOT_FOUND',
        last_lookup_at = NOW(),
        error_message = VALUES(error_message)`,
      [
        row.hiware_user_no,
        row.hiware_user_id ?? null,
        row.hiware_user_name ?? null,
        row.email_addr,
        `UNMAPPED_${row.hiware_user_no}`,
        errorMessage?.slice(0, 4000),
      ]
    );
  }

  async findAllMapped() {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM slack_user_mappings WHERE mapping_status = 'MAPPED' AND slack_user_id != ''`
    );
    return rows;
  }

  async findByHiwareUserNo(userNo) {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM slack_user_mappings WHERE hiware_user_no = ? AND mapping_status = 'MAPPED' LIMIT 1`,
      [userNo]
    );
    return rows[0] || null;
  }
}

export const slackUserMappingRepository = new SlackUserMappingRepository();
