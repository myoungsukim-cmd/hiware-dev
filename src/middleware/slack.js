import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * Slack Interactivity: application/x-www-form-urlencoded
 * raw body 필요 → verify 콜백으로 저장
 */
export function slackUrlencoded() {
  return (req, res, next) => {
    if (req.rawBody) return next();

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(req.rawBody);
      req.body = {};
      for (const [k, v] of params) {
        req.body[k] = v;
      }
      next();
    });
    req.on('error', next);
  };
}

export function verifySlackSignature(req, res, next) {
  if (config.slack.skipSignature) {
    logger.debug('slack signature skipped', { path: req.path });
    return next();
  }

  const signingSecret = config.slack.signingSecret;
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  if (!timestamp || !signature) {
    logger.warn('slack signature missing headers', { path: req.path });
    return res.status(401).json({ error: 'Missing Slack signature headers' });
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 60 * 5) {
    logger.warn('slack signature stale', { path: req.path, ageSec: age });
    return res.status(401).json({ error: 'Stale Slack request' });
  }

  const base = 'v0:' + timestamp + ':' + req.rawBody;
  const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  const expected = 'v0=' + hmac;

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!ok) {
      logger.warn('slack signature invalid', { path: req.path });
      return res.status(401).json({ error: 'Invalid Slack signature' });
    }
  } catch {
    logger.warn('slack signature compare failed', { path: req.path });
    return res.status(401).json({ error: 'Invalid Slack signature' });
  }

  next();
}
