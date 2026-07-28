import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';

  if (status >= 500) {
    logger.error('request error', {
      path: req.path,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
  }

  res.status(status).json({
    error: err.message || 'Internal Server Error',
    code,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.path });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
