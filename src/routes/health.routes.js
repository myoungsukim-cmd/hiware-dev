import { Router } from 'express';
import { asyncExecutor } from '../lib/AsyncExecutor.js';
import { getPool } from '../db/pool.js';

const router = Router();
const startedAt = Date.now();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'slack-hiware-approval',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    async: asyncExecutor.getStats(),
  });
});

router.get('/ready', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', error: err.message });
  }
});

export default router;
