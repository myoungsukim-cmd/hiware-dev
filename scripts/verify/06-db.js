#!/usr/bin/env node
/**
 * Step 06 — MySQL 연결 + 필수 테이블
 * 기획 §12 / PRESENTATION 테이블 목록
 */
import mysql from 'mysql2/promise';
import { resolveDbEnv } from '../../src/lib/dbEnv.js';
import { ok, exitFail } from './lib.js';

const REQUIRED = [
  'hiware_users',
  'slack_user_mappings',
  'approval_items',
  'approval_approvers',
  'slack_messages',
  'approval_action_logs',
  'slack_requester_notifications',
  'slack_action_jobs',
  'worker_locks',
  'schema_migrations',
];

try {
  const db = resolveDbEnv(process.env);
  if (!db.user || !db.password || !db.database) {
    exitFail('DB env 부족', 'DB_USERNAME / DB_PASSWORD / DB_CATALOG');
  }

  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
  });

  const [tables] = await conn.query('SHOW TABLES');
  const names = new Set(tables.map((r) => Object.values(r)[0]));
  const missing = REQUIRED.filter((t) => !names.has(t));
  await conn.end();

  if (missing.length) {
    exitFail('필수 테이블 없음', `${missing.join(', ')} — npm run db:init 실행`);
  }
  ok('MySQL', `${db.database} tables=${names.size} (필수 ${REQUIRED.length}개 확인)`);
  process.exit(0);
} catch (err) {
  exitFail('MySQL', err.message);
}
