#!/usr/bin/env node
/**
 * 검증 공통 — PASS/FAIL 출력, .env 로드
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

export function ok(msg, detail) {
  console.log(`[OK] ${msg}${detail ? ` — ${detail}` : ''}`);
}

export function fail(msg, detail) {
  console.error(`[FAIL] ${msg}${detail ? ` — ${detail}` : ''}`);
}

export function info(msg) {
  console.log(`[INFO] ${msg}`);
}

export function skip(msg) {
  console.log(`[SKIP] ${msg}`);
}

/** @returns {never} */
export function exitFail(msg, detail) {
  fail(msg, detail);
  process.exit(1);
}

export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
}

export function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n] || process.env[n] === '');
  return missing;
}

export function parseUserNos(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,:\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
