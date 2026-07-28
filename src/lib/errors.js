export class AppError extends Error {
  constructor(message, { status = 500, code = 'APP_ERROR' } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export class TaskRejectedError extends Error {
  constructor(message = 'Async task rejected: queue capacity exceeded') {
    super(message);
    this.name = 'TaskRejectedError';
    this.status = 503;
    this.code = 'TASK_REJECTED';
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400, code: 'VALIDATION_ERROR' });
    this.name = 'ValidationError';
  }
}
