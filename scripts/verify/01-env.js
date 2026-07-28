#!/usr/bin/env node
/**
 * Step 01 — .env / 설정 검증
 * 기획: 배포 체크리스트, ID/PW 또는 TOKEN
 */
import { config } from '../../src/config/index.js';
import { ok, fail, info, exitFail } from './lib.js';

const missing = [];
if (!config.hiware.baseUrl) missing.push('HIWARE_BASE_URL');
const hasLogin = Boolean(config.hiware.userId && config.hiware.userPwd);
const hasToken = Boolean(config.hiware.apiToken);
if (!hasLogin && !hasToken) {
  missing.push('HIWARE_USER_ID+HIWARE_USER_PWD (권장) 또는 HIWARE_API_TOKEN');
}
if (!config.mysql.password || config.mysql.password === 'change-me') {
  missing.push('DB_PASSWORD (실값)');
}
if (!config.slack.botToken || config.slack.botToken.includes('your-bot-token')) {
  info('SLACK_BOT_TOKEN 미설정 — Slack 단계는 나중에 SKIP 가능');
}

if (missing.length) {
  exitFail('필수 환경변수 부족', missing.join(', '));
}

ok('환경변수', hasLogin ? `loginMode userId=${config.hiware.userId}` : 'staticTokenMode');
info(`HIWARE_BASE_URL=${config.hiware.baseUrl}`);
info(`DB=${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
process.exit(0);
