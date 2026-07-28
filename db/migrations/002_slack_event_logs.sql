-- Slack 연동 이벤트 감사 로그
-- npm run db:init  → schema.sql 후 미적용 migration 자동 실행
-- npm run db:migrate → 이 파일만 단독 적용 (기존 DB 업그레이드)

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
