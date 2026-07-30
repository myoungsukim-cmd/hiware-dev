import { getPool } from '../db/pool.js';

export class ApprovalItemRepository {
  async findByApvNo(apvApltNo, conn = null) {
    const db = conn || getPool();
    const [rows] = await db.query(`SELECT * FROM approval_items WHERE apv_aplt_no = ? LIMIT 1`, [apvApltNo]);
    return rows[0] || null;
  }

  async findByApvNoForUpdate(apvApltNo, conn) {
    const [rows] = await conn.query(`SELECT * FROM approval_items WHERE apv_aplt_no = ? FOR UPDATE`, [apvApltNo]);
    return rows[0] || null;
  }

  async upsertFromIntray(row) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO approval_items (
        apv_aplt_no, apv_title, apv_req_user_no, apv_req_user_id, apv_req_user_name,
        apv_req_dttm, status, apv_state_code, apv_state_name,
        apv_reflt_state_code, apv_reflt_state_name, summary_contents, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        apv_title = VALUES(apv_title),
        apv_req_user_no = VALUES(apv_req_user_no),
        apv_req_user_id = VALUES(apv_req_user_id),
        apv_req_user_name = VALUES(apv_req_user_name),
        apv_req_dttm = VALUES(apv_req_dttm),
        apv_state_code = VALUES(apv_state_code),
        apv_state_name = VALUES(apv_state_name),
        apv_reflt_state_code = VALUES(apv_reflt_state_code),
        apv_reflt_state_name = VALUES(apv_reflt_state_name),
        summary_contents = VALUES(summary_contents),
        raw_json = VALUES(raw_json),
        status = IF(status IN ('REJECTED','CANCELED'), status, 'IN_PROGRESS')`,
      [
        row.apv_aplt_no,
        row.apv_title,
        row.apv_req_user_no,
        row.apv_req_user_id,
        row.apv_req_user_name,
        row.apv_req_dttm,
        row.apv_state_code,
        row.apv_state_name,
        row.apv_reflt_state_code,
        row.apv_reflt_state_name,
        row.summary_contents,
        row.raw_json ? JSON.stringify(row.raw_json) : null,
      ]
    );
  }

  async updateStatus(apvApltNo, fields, conn = null) {
    const db = conn || getPool();
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
    vals.push(apvApltNo);
    await db.query(`UPDATE approval_items SET ${sets.join(', ')} WHERE apv_aplt_no = ?`, vals);
  }

  async findActiveItems() {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM approval_items WHERE status IN ('PENDING','IN_PROGRESS')`
    );
    return rows;
  }
}

export const approvalItemRepository = new ApprovalItemRepository();
