#!/usr/bin/env node
/**
 * Step 08 — Slack auth.test
 * Bot Token 유효성 (DM E2E 전 단계)
 */
import { Agent, fetch } from 'undici';
import { env, ok, skip, exitFail } from './lib.js';

const token = env('SLACK_BOT_TOKEN', '');
if (!token || token.includes('your-bot-token')) {
  skip('SLACK_BOT_TOKEN 미설정 — Slack App 등록 후 재실행');
  process.exit(0);
}

try {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
    dispatcher: new Agent({ connect: { rejectUnauthorized: true } }),
  });
  const data = await res.json();
  if (!data.ok) {
    exitFail('Slack auth.test', data.error || JSON.stringify(data));
  }
  ok('Slack auth.test', `team=${data.team} user=${data.user} bot_id=${data.bot_id || '-'}`);
  process.exit(0);
} catch (err) {
  exitFail('Slack auth.test', err.message);
}
