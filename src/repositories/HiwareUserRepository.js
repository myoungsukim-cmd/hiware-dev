import { getPool } from '../db/pool.js';

export class HiwareUserRepository {
  async upsert(user) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO hiware_users (
        hiware_user_no, hiware_user_id, hiware_user_name, email_addr, hp_no,
        user_group_no, user_state_code, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        hiware_user_id = VALUES(hiware_user_id),
        hiware_user_name = VALUES(hiware_user_name),
        email_addr = CASE
          WHEN VALUES(email_addr) IS NOT NULL AND VALUES(email_addr) != '' AND VALUES(email_addr) NOT IN ('********')
            AND VALUES(email_addr) LIKE '%@%'
          THEN VALUES(email_addr)
          ELSE email_addr
        END,
        hp_no = VALUES(hp_no),
        user_group_no = VALUES(user_group_no),
        user_state_code = VALUES(user_state_code),
        raw_json = VALUES(raw_json),
        synced_at = NOW()`,
      [
        user.hiware_user_no,
        user.hiware_user_id,
        user.hiware_user_name,
        user.email_addr ?? null,
        user.hp_no ?? null,
        user.user_group_no ?? null,
        user.user_state_code ?? null,
        user.raw_json ? JSON.stringify(user.raw_json) : null,
      ]
    );
  }

  async findWithEmail() {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM hiware_users
       WHERE email_addr IS NOT NULL
         AND email_addr != ''
         AND email_addr NOT IN ('********')
         AND email_addr LIKE '%@%'`
    );
    return rows;
  }

  async findByUserNo(userNo) {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM hiware_users WHERE hiware_user_no = ? LIMIT 1`, [userNo]);
    return rows[0] || null;
  }
}

export const hiwareUserRepository = new HiwareUserRepository();
