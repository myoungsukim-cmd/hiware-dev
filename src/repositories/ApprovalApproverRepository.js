import { getPool } from '../db/pool.js';

export class ApprovalApproverRepository {
  async upsertFromIntray(row) {
    const pool = getPool();
    const sql =
      "INSERT INTO approval_approvers (" +
      "  apv_aplt_no, hiware_user_no, hiware_user_id, hiware_user_name, slack_user_id," +
      "  approval_step, approval_rule, approval_group_key, approver_status" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'WAITING')" +
      " ON DUPLICATE KEY UPDATE" +
      "  hiware_user_id = VALUES(hiware_user_id)," +
      "  hiware_user_name = VALUES(hiware_user_name)," +
      "  slack_user_id = COALESCE(VALUES(slack_user_id), slack_user_id)," +
      "  approval_rule = VALUES(approval_rule)," +
      "  approval_group_key = VALUES(approval_group_key)," +
      "  approver_status = IF(" +
      "    approver_status IN ('APPROVED','REJECTED','SKIPPED','NOTIFIED')," +
      "    approver_status," +
      "    'WAITING'" +
      "  )";
    await pool.query(sql, [
      row.apv_aplt_no,
      row.hiware_user_no,
      row.hiware_user_id,
      row.hiware_user_name,
      row.slack_user_id,
      row.approval_step,
      row.approval_rule,
      row.approval_group_key,
    ]);
  }

  async markParallelRule(apvApltNo, step) {
    const pool = getPool();
    const groupKey = 'apv:' + apvApltNo + ':step:' + step;
    await pool.query(
      "UPDATE approval_approvers SET approval_rule = 'ANY_ONE', approval_group_key = ?" +
        " WHERE apv_aplt_no = ? AND approval_step = ? AND approver_status IN ('WAITING','NOTIFIED')",
      [groupKey, apvApltNo, step]
    );
  }

  async countActiveAtStep(apvApltNo, step) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS c FROM approval_approvers" +
        " WHERE apv_aplt_no = ? AND approval_step = ? AND approver_status IN ('WAITING','NOTIFIED')",
      [apvApltNo, step]
    );
    return rows[0].c;
  }

  async findById(id, conn = null) {
    const db = conn || getPool();
    const [rows] = await db.query('SELECT * FROM approval_approvers WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async findBySlackUserAndApv(slackUserId, apvApltNo) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM approval_approvers" +
        " WHERE slack_user_id = ? AND apv_aplt_no = ?" +
        " AND approver_status IN ('WAITING','NOTIFIED')" +
        " ORDER BY approval_step DESC LIMIT 1",
      [slackUserId, apvApltNo]
    );
    return rows[0] || null;
  }

  async findForAction(slackUserId, apvApltNo, currentStep, conn) {
    const [rows] = await conn.query(
      "SELECT * FROM approval_approvers" +
        " WHERE slack_user_id = ? AND apv_aplt_no = ? AND approval_step = ? FOR UPDATE",
      [slackUserId, apvApltNo, currentStep]
    );
    return rows[0] || null;
  }

  async findNeedingNotification() {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT aa.* FROM approval_approvers aa" +
        " JOIN approval_items ai ON ai.apv_aplt_no = aa.apv_aplt_no" +
        " LEFT JOIN slack_messages sm ON sm.approver_id = aa.id" +
        " WHERE aa.approver_status = 'WAITING'" +
        " AND ai.status IN ('PENDING','IN_PROGRESS')" +
        " AND aa.slack_user_id IS NOT NULL AND aa.slack_user_id != ''" +
        " AND sm.id IS NULL"
    );
    return rows;
  }

  async findDueForReminder({ firstDelayMin, intervalMin, maxCount }) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT aa.*, sm.slack_channel_id, sm.slack_message_ts" +
        " FROM approval_approvers aa" +
        " JOIN approval_items ai ON ai.apv_aplt_no = aa.apv_aplt_no" +
        " JOIN slack_messages sm ON sm.approver_id = aa.id" +
        " WHERE aa.approver_status = 'NOTIFIED'" +
        " AND ai.status IN ('PENDING','IN_PROGRESS')" +
        " AND aa.reminder_count < ?" +
        " AND aa.notified_at IS NOT NULL" +
        " AND (" +
        "   (aa.reminder_count = 0 AND aa.notified_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE))" +
        "   OR (aa.reminder_count > 0 AND COALESCE(aa.last_reminded_at, aa.notified_at) <= DATE_SUB(NOW(), INTERVAL ? MINUTE))" +
        " )",
      [maxCount, firstDelayMin, intervalMin]
    );
    return rows;
  }

  async markNotified(id) {
    const pool = getPool();
    await pool.query(
      "UPDATE approval_approvers SET approver_status = 'NOTIFIED', notified_at = NOW() WHERE id = ?",
      [id]
    );
  }

  async markReminded(id) {
    const pool = getPool();
    await pool.query(
      "UPDATE approval_approvers SET last_reminded_at = NOW(), reminder_count = reminder_count + 1 WHERE id = ?",
      [id]
    );
  }

  async updateStatus(id, fields, conn = null) {
    const db = conn || getPool();
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      sets.push(k + ' = ?');
      vals.push(v);
    }
    vals.push(id);
    await db.query('UPDATE approval_approvers SET ' + sets.join(', ') + ' WHERE id = ?', vals);
  }

  async skipOthersAtStep(apvApltNo, step, exceptId, conn) {
    await conn.query(
      "UPDATE approval_approvers SET approver_status = 'SKIPPED', acted_at = NOW()" +
        " WHERE apv_aplt_no = ? AND approval_step = ? AND id != ?" +
        " AND approver_status IN ('WAITING','NOTIFIED')",
      [apvApltNo, step, exceptId]
    );
  }

  async skipAllPending(apvApltNo, exceptId, conn) {
    await conn.query(
      "UPDATE approval_approvers SET approver_status = 'SKIPPED', acted_at = NOW()" +
        " WHERE apv_aplt_no = ? AND id != ? AND approver_status IN ('WAITING','NOTIFIED')",
      [apvApltNo, exceptId]
    );
  }

  async findWithMessages(apvApltNo) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT sm.*, aa.*" +
        " FROM slack_messages sm" +
        " JOIN approval_approvers aa ON sm.approver_id = aa.id" +
        " WHERE sm.apv_aplt_no = ? AND sm.message_status IN ('SENT','UPDATED')",
      [apvApltNo]
    );
    return rows;
  }

  async findLatestActor(apvApltNo) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM approval_approvers" +
        " WHERE apv_aplt_no = ? AND approver_status IN ('APPROVED','REJECTED') AND acted_at IS NOT NULL" +
        " ORDER BY acted_at DESC LIMIT 1",
      [apvApltNo]
    );
    return rows[0] || null;
  }
}

export const approvalApproverRepository = new ApprovalApproverRepository();
