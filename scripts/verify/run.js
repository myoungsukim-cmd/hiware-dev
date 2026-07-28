#!/usr/bin/env node
/**
 * 단계별 검증 러너 — 기획 PoC / 배포 체크리스트
 *
 * 사용:
 *   npm run verify              # 전체 (01→08)
 *   npm run verify -- 02        # 02부터
 *   npm run verify -- 02 05     # 02~05
 *   npm run verify -- 01 02 06  # 지정 단계만
 *
 * 전부 [OK] / [SKIP] 이면 연동 코어 정상. [FAIL] 있으면 exit 1.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { id: '01', file: '01-env.js', title: '환경변수' },
  { id: '02', file: '02-hiware-login.js', title: 'HIWARE 로그인/토큰' },
  { id: '03', file: '03-hiware-users.js', title: 'GET /users' },
  { id: '04', file: '04-hiware-intray.js', title: 'intray (§24.1 #3)' },
  { id: '05', file: '05-hiware-detail.js', title: '결재 상세' },
  { id: '06', file: '06-db.js', title: 'MySQL 스키마' },
  { id: '07', file: '07-health.js', title: 'API health' },
  { id: '08', file: '08-slack-auth.js', title: 'Slack auth.test' },
];

function runStep(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.resolve(__dirname, '../..'),
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function selectSteps(args) {
  if (!args.length) return STEPS;
  if (args.length === 1) {
    const from = args[0].padStart(2, '0');
    const idx = STEPS.findIndex((s) => s.id === from);
    if (idx < 0) return null;
    return STEPS.slice(idx);
  }
  if (args.length === 2 && /^\d+$/.test(args[0]) && /^\d+$/.test(args[1])) {
    const a = args[0].padStart(2, '0');
    const b = args[1].padStart(2, '0');
    const i = STEPS.findIndex((s) => s.id === a);
    const j = STEPS.findIndex((s) => s.id === b);
    if (i < 0 || j < 0 || i > j) return null;
    return STEPS.slice(i, j + 1);
  }
  const ids = new Set(args.map((a) => a.padStart(2, '0')));
  const picked = STEPS.filter((s) => ids.has(s.id));
  return picked.length ? picked : null;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const selected = selectSteps(args);
if (!selected) {
  console.error('사용법: npm run verify | npm run verify -- 02 | npm run verify -- 02 05');
  process.exit(2);
}

console.log('');
console.log('=== slack-hiware-approval verify ===');
console.log(`steps: ${selected.map((s) => s.id).join(', ')}`);
console.log('');

let failed = 0;
for (const step of selected) {
  console.log(`── Step ${step.id}. ${step.title} ──`);
  const code = await runStep(step.file);
  if (code !== 0) {
    failed += 1;
    console.log('');
    console.error(`>>> Step ${step.id} FAILED (exit ${code}). 이후 단계는 계속하지 않습니다.`);
    break;
  }
  console.log('');
}

if (failed) {
  console.error('RESULT: FAIL — 위 [FAIL] 원인을 고친 뒤 같은 단계부터 재실행하세요.');
  process.exit(1);
}

console.log('RESULT: OK — 선택한 단계 통과. 다음: npm run slack:test-dm (SLACK_TEST_USER_ID, TEST_APV_APLT_NO)');
console.log('        Modal→승인/반려 E2E는 Slack Interactivity URL 등록 후 수동 확인.');
process.exit(0);
