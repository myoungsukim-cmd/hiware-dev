-- =============================================================================
-- Slack ↔ HIWARE 결재 연동 스키마
-- 기획안 §12 + Slack Interactivity 3초 타임아웃 대응 (slack_action_jobs)
-- MySQL 8.0+ / utf8mb4
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 12.1 HIWARE 사용자 동기화
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hiware_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hiware_user_no VARCHAR(50) NOT NULL,
  hiware_user_id VARCHAR(100) NOT NULL,
  hiware_user_name VARCHAR(100) NOT NULL,
  email_addr VARCHAR(255),
  hp_no VARCHAR(50),
  user_group_no VARCHAR(50),
  user_state_code VARCHAR(20),
  raw_json JSON,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hiware_user_no (hiware_user_no),
  KEY idx_hiware_user_id (hiware_user_id),
  KEY idx_email_addr (email_addr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.2 HIWARE ↔ Slack 사용자 매핑
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_user_mappings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hiware_user_no VARCHAR(50) NOT NULL,
  hiware_user_id VARCHAR(100),
  hiware_user_name VARCHAR(100),
  email_addr VARCHAR(255) NOT NULL,
  slack_team_id VARCHAR(100),
  slack_user_id VARCHAR(100) NOT NULL,
  slack_dm_channel_id VARCHAR(100),
  mapping_status VARCHAR(30) NOT NULL DEFAULT 'MAPPED',
  last_lookup_at DATETIME,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hiware_user_no (hiware_user_no),
  UNIQUE KEY uk_slack_user_id (slack_user_id),
  KEY idx_email_addr (email_addr),
  KEY idx_mapping_status (mapping_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.3 결재 문서 마스터 (HIWARE 동기화)
-- status: PENDING, IN_PROGRESS, APPROVED, REJECTED, CANCELED, ERROR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  apv_aplt_no VARCHAR(50) NOT NULL,
  apv_title VARCHAR(500),
  apv_req_user_no VARCHAR(50),
  apv_req_user_id VARCHAR(100),
  apv_req_user_name VARCHAR(100),
  apv_req_dttm DATETIME,
  current_step INT NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  apv_state_code VARCHAR(20),
  apv_state_name VARCHAR(100),
  apv_reflt_state_code VARCHAR(20),
  apv_reflt_state_name VARCHAR(100),
  summary_contents TEXT,
  html_contents MEDIUMTEXT,
  completed_by_hiware_user_no VARCHAR(50),
  completed_by_slack_user_id VARCHAR(100),
  completed_action VARCHAR(20),
  completed_comment TEXT,
  completed_at DATETIME,
  requester_notify_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  requester_notified_at DATETIME NULL,
  raw_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_apv_aplt_no (apv_aplt_no),
  KEY idx_status (status),
  KEY idx_current_step (current_step),
  KEY idx_req_user_no (apv_req_user_no),
  KEY idx_requester_notify_status (requester_notify_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.4 결재자별 step (SINGLE / ANY_ONE / ALL)
-- approver_status: WAITING, NOTIFIED, APPROVED, REJECTED, SKIPPED, ERROR
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_approvers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  apv_aplt_no VARCHAR(50) NOT NULL,
  hiware_user_no VARCHAR(50) NOT NULL,
  hiware_user_id VARCHAR(100),
  hiware_user_name VARCHAR(100),
  slack_user_id VARCHAR(100),
  approval_step INT NOT NULL,
  approval_rule VARCHAR(20) NOT NULL DEFAULT 'SINGLE',
  approval_group_key VARCHAR(100),
  approver_status VARCHAR(30) NOT NULL DEFAULT 'WAITING',
  notified_at DATETIME,
  last_reminded_at DATETIME,
  reminder_count INT NOT NULL DEFAULT 0,
  acted_at DATETIME,
  action_type VARCHAR(20),
  action_comment TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_apv_approver (apv_aplt_no, hiware_user_no, approval_step),
  KEY idx_apv_step (apv_aplt_no, approval_step),
  KEY idx_approver_status (approver_status),
  KEY idx_slack_user_id (slack_user_id),
  KEY idx_group_key (approval_group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.5 결재자 DM 이력 (중복 발송 방지: approver_id UNIQUE)
-- message_status: SENT, UPDATED, COMPLETED, SKIPPED, FAILED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  apv_aplt_no VARCHAR(50) NOT NULL,
  approver_id BIGINT NOT NULL,
  slack_user_id VARCHAR(100) NOT NULL,
  slack_channel_id VARCHAR(100) NOT NULL,
  slack_message_ts VARCHAR(100) NOT NULL,
  message_status VARCHAR(30) NOT NULL DEFAULT 'SENT',
  sent_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_approver_message (approver_id),
  KEY idx_apv_aplt_no (apv_aplt_no),
  KEY idx_slack_message (slack_channel_id, slack_message_ts),
  KEY idx_message_status (message_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.6 승인/반려 액션 로그
-- ※ apvUserPwd 는 payload 에 넣지 말 것 (hiware_request_json 마스킹)
-- process_status: SUCCESS, FAILED, DUPLICATED, VALIDATION_FAILED, HIWARE_ERROR,
--                 QUEUED, PROCESSING
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_action_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  apv_aplt_no VARCHAR(50) NOT NULL,
  approver_id BIGINT,
  slack_user_id VARCHAR(100),
  action_type VARCHAR(20) NOT NULL,
  action_comment TEXT,
  hiware_request_json JSON,
  hiware_response_json JSON,
  hiware_result_code VARCHAR(50),
  hiware_result_message VARCHAR(1000),
  process_status VARCHAR(30) NOT NULL,
  error_message TEXT,
  slack_action_job_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_apv_aplt_no (apv_aplt_no),
  KEY idx_slack_user_id (slack_user_id),
  KEY idx_process_status (process_status),
  KEY idx_created_at (created_at),
  KEY idx_slack_action_job_id (slack_action_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 12.7 기안자 최종 결과 DM
-- notify_type: FINAL_APPROVED, FINAL_REJECTED, FINAL_CANCELED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_requester_notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  apv_aplt_no VARCHAR(50) NOT NULL,
  hiware_user_no VARCHAR(50) NOT NULL,
  slack_user_id VARCHAR(100) NOT NULL,
  slack_channel_id VARCHAR(100) NOT NULL,
  slack_message_ts VARCHAR(100) NOT NULL,
  notify_type VARCHAR(30) NOT NULL,
  message_status VARCHAR(30) NOT NULL DEFAULT 'SENT',
  sent_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_apv_notify_type (apv_aplt_no, notify_type),
  KEY idx_hiware_user_no (hiware_user_no),
  KEY idx_slack_user_id (slack_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- §25.6 Slack 3초 타임아웃 대응 — 비동기 처리 큐
--
-- 흐름 (승인/반려 view_submission):
--   1) API: signature 검증 + comment 검증 (< 1s)
--   2) API: job INSERT (PENDING) + action_log (QUEUED)
--   3) API: HTTP 200 + response_action=update ("처리 중...")
--   4) Worker: job PROCESSING → HIWARE batchApplyApv + DB lock/update
--   5) Worker: views.update 로 최종 결과 / chat.update DM 갱신
--
-- job_type: APPROVAL_ASSENT, APPROVAL_REJECT, OPEN_MODAL (재시도용)
-- status: PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_action_jobs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  apv_aplt_no VARCHAR(50),
  approver_id BIGINT,
  slack_user_id VARCHAR(100) NOT NULL,
  slack_team_id VARCHAR(100),
  slack_view_id VARCHAR(100),
  slack_view_hash VARCHAR(100),
  slack_trigger_id VARCHAR(100),
  slack_response_url VARCHAR(2000),
  payload_json JSON NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  last_error TEXT,
  result_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_idempotency (idempotency_key),
  KEY idx_status_scheduled (status, scheduled_at),
  KEY idx_apv_aplt_no (apv_aplt_no),
  KEY idx_slack_user_id (slack_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Worker 분산 lock (ShedLock 스타일, §25.8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_locks (
  lock_name VARCHAR(100) PRIMARY KEY,
  locked_by VARCHAR(100) NOT NULL,
  locked_until DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 스키마 버전 (init 스크립트 멱등성)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES ('001_initial');

-- ---------------------------------------------------------------------------
-- Slack 연동 이벤트 감사 로그 (DM/Modal/검증/에러 추적)
-- event_status: SUCCESS, FAILED, PENDING, SKIPPED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_event_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  event_status VARCHAR(30) NOT NULL,
  apv_aplt_no VARCHAR(50),
  approver_id BIGINT,
  slack_user_id VARCHAR(100),
  slack_channel_id VARCHAR(100),
  slack_message_ts VARCHAR(100),
  slack_view_id VARCHAR(100),
  slack_action_job_id BIGINT,
  slack_api_method VARCHAR(50),
  slack_error_code VARCHAR(100),
  error_message TEXT,
  metadata_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_event_type (event_type),
  KEY idx_event_status (event_status),
  KEY idx_apv_aplt_no (apv_aplt_no),
  KEY idx_slack_user_id (slack_user_id),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES ('002_slack_event_logs');

SET FOREIGN_KEY_CHECKS = 1;
