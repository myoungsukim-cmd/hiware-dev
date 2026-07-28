#!/usr/bin/env node
/**
 * Step 05 — 결재 상세 GET /approval/aplt/{apvApltNo}
 * 기획 §25.12 #1, htmlCnts 확인
 *
 * env:
 *   TEST_APV_APLT_NO=4   (없으면 intray 첫 건 자동)
 */
import { hiwareClient } from '../../src/clients/HiwareClient.js';
import { ok, info, env, exitFail } from './lib.js';

async function resolveApvNo() {
  const fromEnv = env('TEST_APV_APLT_NO', '');
  if (fromEnv) return String(fromEnv);

  const self = await hiwareClient.getIntray({ start: 0, limit: 20 });
  const rows = Array.isArray(self?.content) ? self.content : [];
  const first = rows[0]?.apvApltNo ?? rows[0]?.apv_aplt_no;
  if (first) {
    info(`TEST_APV_APLT_NO 없음 → intray 첫 건 사용: ${first}`);
    return String(first);
  }
  return null;
}

try {
  const apvApltNo = await resolveApvNo();
  if (!apvApltNo) {
    info('조회할 결재번호 없음 — TEST_APV_APLT_NO 설정 또는 미결 건 필요');
    info('상세 API 호출은 SKIP (로그인·users·intray 까지 OK면 기본 연동은 통과)');
    process.exit(0);
  }

  const data = await hiwareClient.getApprovalDetail(apvApltNo);
  if (String(data?.resultCode) !== '200') {
    exitFail('결재 상세 실패', `resultCode=${data?.resultCode}`);
  }
  const c = data?.content || {};
  const title = c.apvReqTitleNm || c.sbtNm || '(제목없음)';
  const hasHtml = Boolean(c.htmlCnts && String(c.htmlCnts).length > 0);
  ok('GET /approval/aplt/{no}', `apvApltNo=${apvApltNo} title="${title}" htmlCnts=${hasHtml ? 'yes' : 'no'}`);
  process.exit(0);
} catch (err) {
  exitFail('결재 상세', err.message);
}
