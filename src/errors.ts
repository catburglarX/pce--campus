/**
 * Error vocabulary for the application layer.
 *
 * Every error that crosses into the HTTP layer says which status it deserves, which field caused it
 * where a field is to blame, and a message written for the student who will read it on screen.
 */

export type ErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly field?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    details?: { field?: string; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.field = details?.field;
    this.retryAfterSeconds = details?.retryAfterSeconds;
  }
}

export function validationError(message: string, field?: string): AppError {
  return new AppError("validation_failed", message, { field });
}

export function unauthenticated(message = "Please sign in to continue."): AppError {
  return new AppError("unauthenticated", message);
}

export function forbidden(message = "You do not have access to this."): AppError {
  return new AppError("forbidden", message);
}

export function notFound(what: string): AppError {
  return new AppError("not_found", `${what} was not found.`);
}

export function conflict(message: string, field?: string): AppError {
  return new AppError("conflict", message, { field });
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError(
    "rate_limited",
    `Too many attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
    { retryAfterSeconds },
  );
}
