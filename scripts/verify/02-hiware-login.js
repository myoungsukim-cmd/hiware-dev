#!/usr/bin/env node
/**
 * Step 02 — HIWARE 로그인 / authKey 발급
 * 기획: Login Interface → API-Token, 만료 시 재발급 전제
 */
import { HiwareClient } from '../../src/clients/HiwareClient.js';
import { config } from '../../src/config/index.js';
import { ok, info, exitFail } from './lib.js';

const client = new HiwareClient(config.hiware);

try {
  info(`HIWARE_INSECURE=${config.hiware.insecure}`);
  if (client.loginMode) {
    info(`loginMode → ${client.authBaseUrl}`);
    const token = await client.ensureToken({ force: true });
    if (!token || token.length < 8) exitFail('authKey 발급 실패', '빈 토큰');
    ok('HIWARE login', `authKey length=${token.length} (값은 로그에 출력하지 않음)`);
  } else {
    await client.ensureToken();
    ok('HIWARE static token', 'HIWARE_API_TOKEN 사용 (로그인 스킵)');
  }
  process.exit(0);
} catch (err) {
  const cause = err.cause;
  const detail = [err.message, cause?.code, cause?.message].filter(Boolean).join(' | ');
  console.error('[HINT] 배포 서버에서 확인:');
  console.error('  1) curl -vk https://172.25.2.101:11200/hiware/api/v1/auth/randomKey');
  console.error('  2) .env 에 HIWARE_INSECURE=true (자체서명 인증서)');
  console.error('  3) 방화벽/보안그룹: 이 서버 → HIWARE:11200 TCP 허용');
  console.error('  4) HIWARE 프로세스가 11200 리스닝 중인지');
  exitFail('HIWARE 인증 실패', detail);
}
