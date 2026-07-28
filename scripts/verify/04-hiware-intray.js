#!/usr/bin/env node
/**
 * Step 04 — intray (본인 + 타 userNo)
 * 기획 §24.1 #3 — 연동 계정으로 임의 userNo intray 조회 가능 여부
 *
 * 선택 env:
 *   INTRAY_USER_NOS=21,12,14
 */
import { hiwareClient } from '../../src/clients/HiwareClient.js';
import { ok, info, fail, parseUserNos, env, exitFail } from './lib.js';

function extractNos(data) {
  const rows = Array.isArray(data?.content) ? data.content : [];
  return rows
    .map((r) => r.apvApltNo ?? r.apv_aplt_no)
    .filter((v) => v !== undefined && v !== null)
    .map(String);
}

try {
  const self = await hiwareClient.getIntray({ start: 0, limit: 50 });
  if (String(self?.resultCode) !== '200') {
    exitFail('intray(self) 실패', `resultCode=${self?.resultCode}`);
  }
  const selfNos = extractNos(self);
  ok('intray (Token/로그인 사용자)', `count=${selfNos.length} apvApltNos=[${selfNos.slice(0, 10).join(', ')}]`);

  const userNos = parseUserNos(env('INTRAY_USER_NOS', ''));
  if (!userNos.length) {
    info('INTRAY_USER_NOS 미설정 — §24.1 #3 타 userNo 검사는 SKIP (설정 예: INTRAY_USER_NOS=21,12)');
    process.exit(0);
  }

  let otherOk = 0;
  for (const userNo of userNos) {
    try {
      const data = await hiwareClient.getIntray({ userNo, start: 0, limit: 50 });
      if (String(data?.resultCode) !== '200') {
        fail(`intray userNo=${userNo}`, `resultCode=${data?.resultCode}`);
        continue;
      }
      const nos = extractNos(data);
      ok(`intray userNo=${userNo}`, `count=${nos.length} apvApltNos=[${nos.slice(0, 8).join(', ')}]`);
      otherOk += 1;
    } catch (err) {
      fail(`intray userNo=${userNo}`, err.message);
    }
  }

  if (otherOk === 0) {
    exitFail('§24.1 #3', '타 userNo intray 전부 실패 — poll/DM 방식 재검토 필요');
  }
  ok('§24.1 #3', `타 userNo 200 응답 ${otherOk}/${userNos.length}건`);
  process.exit(0);
} catch (err) {
  exitFail('intray', err.message);
}
