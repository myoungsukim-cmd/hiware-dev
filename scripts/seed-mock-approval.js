#!/usr/bin/env node
/**
 * PC 로컬 mock E2E용 결재 시드
 *   HIWARE_MOCK=true 일 때 TEST 결재 + Slack 유저 매핑 생성
 *
 * Usage:
 *   MOCK_SLACK_USER_ID=U06D62WP6TT MOCK_APV_APLT_NO=TEST999 node scripts/seed-mock-approval.js
 */
import { getPool } from '../src/db/pool.js';
import { config } from '../src/config/index.js';

const apvApltNo = process.env.MOCK_APV_APLT_NO || 'TEST999';
const slackUserId = process.env.MOCK_SLACK_USER_ID;
if (!slackUserId) {
  console.error('MOCK_SLACK_USER_ID 필요');
  process.exit(1);
}

const pool = getPool();
try {
  await pool.query(
    `INSERT INTO approval_items (
      apv_aplt_no, apv_title, apv_req_user_no, apv_req_user_id, apv_req_user_name,
      apv_req_dttm, current_step, status, summary_contents
    ) VALUES (?, ?, '1', 'mock-req', 'mock-requester', NOW(), 1, 'PENDING', ?)
    ON DUPLICATE KEY UPDATE
      apv_title = VALUES(apv_title),
      status = 'PENDING',
      current_step = 1,
      summary_contents = VALUES(summary_contents)`,
    [apvApltNo, '[MOCK] 로컬 테스트 결재', 'PC 로컬 mock 상세입니다.']
  );

  await pool.query(
    `INSERT INTO approval_approvers (
      apv_aplt_no, hiware_user_no, hiware_user_id, hiware_user_name, slack_user_id,
      approval_step, approval_rule, approver_status, notified_at
    ) VALUES (?, '999', 'mock-approver', 'mock-approver', ?, 1, 'SINGLE', 'NOTIFIED', NOW())
    ON DUPLICATE KEY UPDATE
      slack_user_id = VALUES(slack_user_id),
      approver_status = 'NOTIFIED',
      notified_at = NOW()`,
    [apvApltNo, slackUserId]
  );

  console.log('seed ok', {
    apvApltNo,
    slackUserId,
    hiwareMock: config.hiware.mock,
  });
} finally {
  await pool.end();
}
