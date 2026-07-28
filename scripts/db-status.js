import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { resolveDbEnv } from '../src/lib/dbEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`환경변수 필요: ${name}`);
  }
  return v;
}

async function main() {
  const db = resolveDbEnv(process.env);
  if (!db.user || !db.password || !db.database) {
    throw new Error('DB_USERNAME, DB_PASSWORD, DB_CATALOG (.env 확인)');
  }

  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
  });

  try {
    const [version] = await conn.query(
      'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5'
    );
    console.log('schema_migrations:', version);

    const [tables] = await conn.query('SHOW TABLES');
    const names = tables.map((r) => Object.values(r)[0]).sort();
    console.log('\n테이블:', names.join(', '));

    for (const t of names) {
      const [cnt] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
      console.log(`  ${t}: ${cnt[0].c} rows`);
    }

    const [hasEventLog] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'slack_event_logs'`
    );
    if (hasEventLog[0].c > 0) {
      const [summary] = await conn.query(
        `SELECT event_status, COUNT(*) AS cnt FROM slack_event_logs GROUP BY event_status ORDER BY cnt DESC`
      );
      console.log('\nslack_event_logs 요약:', summary);

      const [recentFailed] = await conn.query(
        `SELECT id, event_type, apv_aplt_no, slack_error_code, error_message, created_at
         FROM slack_event_logs WHERE event_status = 'FAILED'
         ORDER BY id DESC LIMIT 5`
      );
      if (recentFailed.length) {
        console.log('\n최근 Slack 실패 로그 (5건):');
        for (const row of recentFailed) {
          console.log(`  #${row.id} ${row.event_type} apv=${row.apv_aplt_no} err=${row.error_message || row.slack_error_code}`);
        }
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
