#!/usr/bin/env node
/**
 * Slack DM 테스트 — App 등록 후 결재 DM UI 확인용
 *
 * .env 필수:
 *   SLACK_BOT_TOKEN
 *   SLACK_TEST_USER_ID=Uxxxx   (테스트 받을 Slack user ID)
 *   TEST_APV_APLT_NO=4         (HIWARE 결재번호)
 *
 * 실행: npm run slack:test-dm
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hiwareClient } from '../src/clients/HiwareClient.js';
import { mapHiwareApprovalDetail } from '../src/slack/blockKit.js';
import { approvalNotifyService } from '../src/services/ApprovalNotifyService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const slackUserId = process.env.SLACK_TEST_USER_ID;
const apvApltNo = process.env.TEST_APV_APLT_NO;

if (!process.env.SLACK_BOT_TOKEN) {
  console.error('[ERROR] SLACK_BOT_TOKEN 필요');
  process.exit(1);
}
if (!slackUserId || !apvApltNo) {
  console.error('[ERROR] SLACK_TEST_USER_ID, TEST_APV_APLT_NO 필요');
  process.exit(1);
}

const raw = await hiwareClient.getApprovalDetail(apvApltNo);
const detail = mapHiwareApprovalDetail(raw);
if (!detail?.apvApltNo) {
  console.error('[ERROR] HIWARE 결재 상세 조회 실패');
  process.exit(1);
}

const result = await approvalNotifyService.sendApprovalDm(slackUserId, detail);
if (!result) {
  console.error('[ERROR] DM 발송 실패 — 봇을 워크스페이스에 설치했는지, 사용자와 DM 가능한지 확인');
  process.exit(1);
}

console.log('[OK] 테스트 DM 발송');
console.log(`     channel=${result.channelId} ts=${result.messageTs}`);
console.log('     Slack에서 [상세/처리하기] 클릭 → Modal 확인');
