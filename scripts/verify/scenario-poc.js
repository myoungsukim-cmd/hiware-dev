#!/usr/bin/env node
/**
 * 결재선 시나리오 A/B intray 실측 PoC (§24.1 #4)
 *
 * A: 1차 팀장 → 2차 병렬 3명 ANY_ONE
 * B: 1차 팀장 → 2차 CISO → 3차 병렬 3명 ANY_ONE
 *
 * 사용 예:
 *   POC_SCENARIO=A POC_PHASE=after_submit \
 *     POC_APV_APLT_NO=15 POC_STEP1_USER_NOS=10 POC_PARALLEL_USER_NOS=21,22,23 \
 *     npm run verify:scenario
 *
 *   POC_SCENARIO=B POC_PHASE=after_ciso \
 *     POC_APV_APLT_NO=16 POC_STEP1_USER_NOS=10 POC_CISO_USER_NOS=30 \
 *     POC_PARALLEL_USER_NOS=21,22,23 npm run verify:scenario
 *
 * PHASE:
 *   after_submit  — 상신 직후 (1차만 intray)
 *   after_step1   — 1차 승인 후 (A=병렬3 / B=CISO만)
 *   after_ciso    — B 전용: CISO 승인 후 (병렬3)
 *   after_any_one — 병렬 1명 처리 후 (전원 intray 비움)
 */
import { hiwareClient } from '../../src/clients/HiwareClient.js';
import { ok, fail, info, env, parseUserNos, exitFail } from './lib.js';

const SCENARIO = String(env('POC_SCENARIO', '')).toUpperCase();
const PHASE = String(env('POC_PHASE', '')).toLowerCase();
const APV = String(env('POC_APV_APLT_NO', env('TEST_APV_APLT_NO', '')));

const step1 = parseUserNos(env('POC_STEP1_USER_NOS', ''));
const ciso = parseUserNos(env('POC_CISO_USER_NOS', ''));
const parallel = parseUserNos(env('POC_PARALLEL_USER_NOS', ''));

function usage() {
  console.error(`사용법:
  POC_SCENARIO=A|B
  POC_PHASE=after_submit|after_step1|after_ciso|after_any_one
  POC_APV_APLT_NO=<결재번호>
  POC_STEP1_USER_NOS=<팀장 userNo,콤마>
  POC_PARALLEL_USER_NOS=<병렬3 userNo,콤마>
  POC_CISO_USER_NOS=<CISO userNo>   # B만

예:
  POC_SCENARIO=A POC_PHASE=after_submit POC_APV_APLT_NO=15 \\
    POC_STEP1_USER_NOS=10 POC_PARALLEL_USER_NOS=21,22,23 npm run verify:scenario
`);
}

async function hasApv(userNo, apvNo) {
  const data = await hiwareClient.getIntray({ userNo, start: 0, limit: 100 });
  if (String(data?.resultCode) !== '200') {
    throw new Error(`intray userNo=${userNo} resultCode=${data?.resultCode}`);
  }
  const rows = Array.isArray(data?.content) ? data.content : [];
  return rows.some((r) => String(r.apvApltNo ?? r.apv_aplt_no) === String(apvNo));
}

/**
 * @param {string} label
 * @param {string[]} userNos
 * @param {boolean} expectPresent true=있어야 함, false=없어야 함
 */
async function checkGroup(label, userNos, expectPresent) {
  if (!userNos.length) {
    fail(`${label}`, 'userNo 목록 비어 있음');
    return { ok: false, hits: [] };
  }
  const hits = [];
  let groupOk = true;
  for (const userNo of userNos) {
    const present = await hasApv(userNo, APV);
    hits.push({ userNo, present });
    const pass = expectPresent ? present : !present;
    if (pass) {
      ok(`${label} userNo=${userNo}`, expectPresent ? 'intray 있음' : 'intray 없음');
    } else {
      fail(
        `${label} userNo=${userNo}`,
        expectPresent ? 'intray에 없음 (노출되어야 함)' : 'intray에 있음 (노출되면 안 됨)'
      );
      groupOk = false;
    }
  }
  return { ok: groupOk, hits };
}

function expectedForPhase() {
  if (SCENARIO === 'A') {
    if (PHASE === 'after_submit') {
      return {
        desc: 'A 상신 직후: 1차만 intray, 병렬3은 없음',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: true },
          { label: '2차(병렬)', nos: parallel, expect: false },
        ],
        next: 'HIWARE/Slack에서 1차 승인 후 POC_PHASE=after_step1 로 재실행',
      };
    }
    if (PHASE === 'after_step1') {
      return {
        desc: 'A 1차 승인 후: 병렬3 전원 intray (§24.1 #4)',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: false },
          { label: '2차(병렬)', nos: parallel, expect: true },
        ],
        next: '병렬 3명 중 1명 Slack 승인 후 POC_PHASE=after_any_one 로 재실행. DM 3통·ANY_ONE SKIPPED 확인',
      };
    }
    if (PHASE === 'after_any_one') {
      return {
        desc: 'A 병렬 1명 처리 후: 전원 intray 비움',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: false },
          { label: '2차(병렬)', nos: parallel, expect: false },
        ],
        next: '시나리오 A intray PoC 완료. Slack에서 나머지 2명 DM이 SKIPPED/갱신됐는지 확인',
      };
    }
  }

  if (SCENARIO === 'B') {
    if (PHASE === 'after_submit') {
      return {
        desc: 'B 상신 직후: 1차만, CISO·병렬 없음',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: true },
          { label: '2차(CISO)', nos: ciso, expect: false },
          { label: '3차(병렬)', nos: parallel, expect: false },
        ],
        next: '1차 승인 후 POC_PHASE=after_step1 재실행',
      };
    }
    if (PHASE === 'after_step1') {
      return {
        desc: 'B 1차 승인 후: CISO만, 병렬 없음',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: false },
          { label: '2차(CISO)', nos: ciso, expect: true },
          { label: '3차(병렬)', nos: parallel, expect: false },
        ],
        next: 'CISO 승인 후 POC_PHASE=after_ciso 재실행',
      };
    }
    if (PHASE === 'after_ciso') {
      return {
        desc: 'B CISO 승인 후: 병렬3 전원 (§24.1 #4)',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: false },
          { label: '2차(CISO)', nos: ciso, expect: false },
          { label: '3차(병렬)', nos: parallel, expect: true },
        ],
        next: '병렬 1명 승인 후 POC_PHASE=after_any_one 재실행',
      };
    }
    if (PHASE === 'after_any_one') {
      return {
        desc: 'B 병렬 1명 처리 후: 전원 intray 비움',
        checks: [
          { label: '1차(팀장)', nos: step1, expect: false },
          { label: '2차(CISO)', nos: ciso, expect: false },
          { label: '3차(병렬)', nos: parallel, expect: false },
        ],
        next: '시나리오 B intray PoC 완료. Slack SKIPPED DM 갱신 확인',
      };
    }
  }

  return null;
}

if (!['A', 'B'].includes(SCENARIO) || !APV || !PHASE) {
  usage();
  process.exit(2);
}

if (!step1.length || !parallel.length) {
  usage();
  exitFail('POC_STEP1_USER_NOS / POC_PARALLEL_USER_NOS 필요');
}
if (SCENARIO === 'B' && !ciso.length) {
  usage();
  exitFail('시나리오 B는 POC_CISO_USER_NOS 필요');
}

const spec = expectedForPhase();
if (!spec) {
  usage();
  exitFail('알 수 없는 PHASE', `${SCENARIO}/${PHASE}`);
}

console.log('');
console.log(`=== Scenario ${SCENARIO} / ${PHASE} / apv=${APV} ===`);
info(spec.desc);
console.log('');

let allOk = true;
try {
  for (const c of spec.checks) {
    const r = await checkGroup(c.label, c.nos, c.expect);
    if (!r.ok) allOk = false;
  }
} catch (err) {
  exitFail('intray 조회 실패', err.message);
}

console.log('');
info(`다음: ${spec.next}`);

if (!allOk) {
  console.error('RESULT: FAIL — HIWARE 결재선/intray 노출을 먼저 맞추세요. Slack 코드 문제가 아닐 수 있습니다.');
  process.exit(1);
}

console.log(`RESULT: OK — 시나리오 ${SCENARIO} phase=${PHASE} intray 패턴 통과`);
process.exit(0);
