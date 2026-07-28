import { config } from '../config/index.js';
import { getPool } from '../db/pool.js';

/**
 * durable 비동기 큐 — slack_action_jobs
 * Slack Interactivity 3초 제한: API는 enqueue 후 즉시 200
 */
export class SlackActionJobRepository {
  /**
   * @param {object} job
   * @returns {Promise<number>} job id
   */
  async enqueue(job) {
    const pool = getPool();
    const [result] = await pool.query(
      `INSERT INTO slack_action_jobs (
        job_type, idempotency_key, apv_aplt_no, approver_id,
        slack_user_id, slack_team_id, slack_view_id, slack_view_hash,
        slack_trigger_id, slack_response_url, payload_json, status, max_attempts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        job.jobType,
        job.idempotencyKey,
        job.apvApltNo ?? null,
        job.approverId ?? null,
        job.slackUserId,
        job.slackTeamId ?? null,
        job.slackViewId ?? null,
        job.slackViewHash ?? null,
        job.slackTriggerId ?? null,
        job.slackResponseUrl ?? null,
        JSON.stringify(job.payload),
        job.maxAttempts ?? config.worker.maxAttempts,
      ]
    );
    return result.insertId;
  }

  /**
   * Worker: PENDING job 선점 (PROCESSING)
   */
  async claimBatch(limit = config.worker.batchSize) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT id FROM slack_action_jobs
         WHERE status = 'PENDING' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      if (rows.length === 0) {
        await conn.commit();
        return [];
      }
      const ids = rows.map((r) => r.id);
      await conn.query(
        `UPDATE slack_action_jobs
         SET status = 'PROCESSING', started_at = NOW(), attempts = attempts + 1
         WHERE id IN (?)`,
        [ids]
      );
      const [jobs] = await conn.query(`SELECT * FROM slack_action_jobs WHERE id IN (?)`, [ids]);
      await conn.commit();
      return jobs;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async complete(id, resultJson = null) {
    const pool = getPool();
    await pool.query(
      `UPDATE slack_action_jobs
       SET status = 'COMPLETED', finished_at = NOW(), result_json = ?
       WHERE id = ?`,
      [resultJson ? JSON.stringify(resultJson) : null, id]
    );
  }

  async fail(id, errorMessage, requeue = false) {
    const pool = getPool();
    if (requeue) {
      await pool.query(
        `UPDATE slack_action_jobs
         SET status = 'PENDING', last_error = ?, started_at = NULL
         WHERE id = ? AND attempts < max_attempts`,
        [errorMessage?.slice(0, 4000) ?? 'unknown', id]
      );
      return;
    }
    await pool.query(
      `UPDATE slack_action_jobs
       SET status = 'FAILED', finished_at = NOW(), last_error = ?
       WHERE id = ?`,
      [errorMessage?.slice(0, 4000) ?? 'unknown', id]
    );
  }
}

export const slackActionJobRepository = new SlackActionJobRepository();
