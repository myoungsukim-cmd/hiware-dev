const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const lv = process.env.LOG_LEVEL || 'info';
  return LEVELS[lv] ?? LEVELS.info;
}

function log(level, msg, meta = undefined) {
  if (LEVELS[level] < currentLevel()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? { meta } : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else console.log(out);
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
