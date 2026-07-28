#!/usr/bin/env node
/**
 * Step 07 — API health/ready
 * 서버가 떠 있어야 함: npm start 또는 pm2
 *
 * env:
 *   VERIFY_BASE_URL=http://127.0.0.1:3000  (기본)
 */
import { Agent, fetch } from 'undici';
import { env, ok, skip, exitFail, info } from './lib.js';

const base = (env('VERIFY_BASE_URL', 'http://127.0.0.1:3000') || '').replace(/\/$/, '');
const insecure = env('HIWARE_INSECURE', 'true') === 'true';
const dispatcher = insecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;

try {
  const live = await fetch(`${base}/health`, { ...(dispatcher ? { dispatcher } : {}) });
  if (!live.ok) exitFail('/health', `HTTP ${live.status}`);
  ok('GET /health', `${base}/health → ${live.status}`);

  const ready = await fetch(`${base}/health/ready`, { ...(dispatcher ? { dispatcher } : {}) });
  const body = await ready.text();
  if (!ready.ok) {
    exitFail('/health/ready', `HTTP ${ready.status} ${body.slice(0, 200)}`);
  }
  ok('GET /health/ready', `HTTP ${ready.status}`);
  process.exit(0);
} catch (err) {
  if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
    skip(`API 서버 미기동 (${base}) — npm start 후 재실행`);
    info('이 단계는 서버 기동 후 필수. 앞선 HIWARE/DB OK면 연동 코어는 통과한 상태.');
    process.exit(0);
  }
  exitFail('/health', err.message);
}
