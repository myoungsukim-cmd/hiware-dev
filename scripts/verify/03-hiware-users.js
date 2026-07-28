#!/usr/bin/env node
/**
 * Step 03 — GET /users
 * 기획 §25.12 #1, PRESENTATION PoC
 */
import { hiwareClient } from '../../src/clients/HiwareClient.js';
import { ok, exitFail } from './lib.js';

try {
  const data = await hiwareClient.getUsers({ start: 0, limit: 100 });
  const list = Array.isArray(data?.content) ? data.content : data?.content?.list || [];
  const count = list.length;
  if (String(data?.resultCode) !== '200') {
    exitFail('/users 실패', `resultCode=${data?.resultCode}`);
  }
  ok('GET /users', `${count}명`);
  process.exit(0);
} catch (err) {
  exitFail('GET /users', err.message);
}
