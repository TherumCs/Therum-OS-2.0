// Structured errors — every failure has a stable { code, message, field?, details? }.
// No "success: false" ambiguity; callers and clients can switch on `code`.

export interface ErrorShape {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly field?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, opts?: { field?: string; details?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.field = opts?.field;
    this.details = opts?.details;
  }

  toShape(): ErrorShape {
    return { code: this.code, message: this.message, field: this.field, details: this.details };
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', field?: string) {
    super('not_found', message, 404, { field });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string, details?: unknown) {
    super('validation_error', message, 422, { field, details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, field?: string) {
    super('conflict', message, 409, { field });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('unauthorized', message, 401);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, retryAfterSeconds: number) {
    super('too_many_requests', message, 429, { details: { retryAfterSeconds } });
  }
}
