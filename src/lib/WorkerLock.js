import os from 'node:os';
import { getPool } from '../db/pool.js';

const LOCK_OWNER = `${os.hostname()}:${process.pid}`;

export async function acquireWorkerLock(lockName, ttlSec = 300) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM worker_locks WHERE lock_name = ? AND locked_until < NOW()`, [lockName]);
    const [existing] = await conn.query(`SELECT locked_until FROM worker_locks WHERE lock_name = ? FOR UPDATE`, [lockName]);
    if (existing.length > 0) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      `INSERT INTO worker_locks (lock_name, locked_by, locked_until) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [lockName, LOCK_OWNER, ttlSec]
    );
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function releaseWorkerLock(lockName) {
  const pool = getPool();
  await pool.query(`DELETE FROM worker_locks WHERE lock_name = ? AND locked_by = ?`, [lockName, LOCK_OWNER]);
}
