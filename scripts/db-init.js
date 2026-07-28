import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { resolveDbEnv } from '../src/lib/dbEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const MIGRATIONS_DIR = path.join(projectRoot, 'db', 'migrations');

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`환경변수 필요: ${name} (.env.example 참고)`);
  }
  return v;
}

function parseArgs(argv) {
  return {
    migrateOnly: argv.includes('--migrate-only'),
    skipSchema: argv.includes('--skip-schema'),
  };
}

async function ensureDatabase(connWithoutDb, database) {
  await connWithoutDb.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`[OK] database: ${database}`);
}

async function runSqlFile(conn, filePath, label) {
  const sql = await fs.readFile(filePath, 'utf8');
  await conn.query(sql);
  console.log(`[OK] ${label}`);
}

async function getAppliedVersions(conn) {
  try {
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    return new Set(rows.map((r) => r.version));
  } catch {
    return new Set();
  }
}

async function runPendingMigrations(conn) {
  let files;
  try {
    files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[SKIP] db/migrations 없음');
      return;
    }
    throw err;
  }

  if (files.length === 0) {
    console.log('[SKIP] 적용할 migration 파일 없음');
    return;
  }

  const applied = await getAppliedVersions(conn);

  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) {
      console.log(`[SKIP] migration already applied: ${version}`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, 'utf8');
    await conn.query(sql);

    if (!sql.includes('schema_migrations')) {
      await conn.query('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version]);
    }

    console.log(`[OK] migration applied: ${version}`);
    applied.add(version);
  }
}

async function listTables(conn) {
  const [rows] = await conn.query('SHOW TABLES');
  return rows.map((r) => Object.values(r)[0]);
}

async function listMigrations(conn) {
  try {
    const [rows] = await conn.query(
      'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at'
    );
    return rows;
  } catch {
    return [];
  }
}

async function main() {
  const { migrateOnly, skipSchema } = parseArgs(process.argv.slice(2));

  const db = resolveDbEnv(process.env);
  const { host, port, user, password, database } = db;

  if (!user) throw new Error('환경변수 필요: DB_USERNAME (또는 MYSQL_USER)');
  if (!password) throw new Error('환경변수 필요: DB_PASSWORD (또는 MYSQL_PASSWORD)');
  if (!database) throw new Error('환경변수 필요: DB_CATALOG (또는 MYSQL_DATABASE)');

  const schemaFile = env('DB_SCHEMA_FILE', path.join(projectRoot, 'db', 'schema.sql'));
  const schemaPath = path.isAbsolute(schemaFile)
    ? schemaFile
    : path.join(projectRoot, schemaFile);

  console.log('=== Slack-HIWARE DB init ===');
  console.log(`host=${host}:${port} db=${database}`);
  if (!migrateOnly && !skipSchema) {
    console.log(`schema=${schemaPath}`);
  }
  console.log(`migrations=${MIGRATIONS_DIR}`);
  if (migrateOnly) console.log('mode=migrate-only');

  if (!migrateOnly) {
    const bootstrap = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true,
    });
    try {
      await ensureDatabase(bootstrap, database);
    } finally {
      await bootstrap.end();
    }
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    if (!migrateOnly && !skipSchema) {
      await runSqlFile(conn, schemaPath, 'schema.sql applied');
    }

    await runPendingMigrations(conn);

    const tables = await listTables(conn);
    const migrations = await listMigrations(conn);

    console.log('\n=== schema_migrations ===');
    for (const m of migrations) {
      console.log(`  ${m.version}  (${m.applied_at})`);
    }

    console.log('\n=== 테이블 목록 ===');
    for (const t of tables.sort()) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``);
      console.log(`  ${t} (${cols.length} columns)`);
    }

    console.log('\n완료.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
