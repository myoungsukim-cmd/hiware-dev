import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

let pool;

export function getPool() {
  if (!pool) {
    const { mysql: db } = config;
    pool = mysql.createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      waitForConnections: true,
      connectionLimit: db.poolSize,
      timezone: '+09:00',
    });
  }
  return pool;
}

export async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
