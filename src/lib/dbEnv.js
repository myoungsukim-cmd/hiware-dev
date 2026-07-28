/**
 * DB 환경변수 — Querypie 스타일 DB_* 우선, MYSQL_* 레거시 호환
 */
function pick(env, primary, legacy, fallback) {
  const v = env[primary] ?? env[legacy];
  if (v === undefined || v === '') return fallback;
  return v;
}

export function resolveDbEnv(env = process.env) {
  return {
    host: pick(env, 'DB_HOST', 'MYSQL_HOST', '127.0.0.1'),
    port: Number(pick(env, 'DB_PORT', 'MYSQL_PORT', '3306')),
    user: pick(env, 'DB_USERNAME', 'MYSQL_USER', 'slack_hiware'),
    password: pick(env, 'DB_PASSWORD', 'MYSQL_PASSWORD', ''),
    database: pick(env, 'DB_CATALOG', 'MYSQL_DATABASE', 'slack_hiware_approval'),
    poolSize: Number(pick(env, 'DB_MAX_CONNECTION_SIZE', 'MYSQL_POOL_SIZE', '10')),
    rootPassword: pick(env, 'DB_ROOT_PASSWORD', 'MYSQL_ROOT_PASSWORD', ''),
  };
}
