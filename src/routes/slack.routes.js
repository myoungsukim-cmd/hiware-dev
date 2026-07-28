import { Router } from 'express';
import { slackController } from '../controllers/SlackController.js';
import { slackUrlencoded, verifySlackSignature } from '../middleware/slack.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.post(
  '/actions',
  slackUrlencoded(),
  verifySlackSignature,
  asyncHandler((req, res) => slackController.handleActions(req, res))
);

export default router;
