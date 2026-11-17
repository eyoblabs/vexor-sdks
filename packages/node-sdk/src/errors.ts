export class VexorError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly responseBody?: string;

  constructor(message: string, options: { statusCode?: number; code?: string; responseBody?: string; cause?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.responseBody = options.responseBody;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class AuthenticationError extends VexorError {}
export class PermissionError extends VexorError {}
export class NotFoundError extends VexorError {}
export class ConflictError extends VexorError {}
export class RateLimitError extends VexorError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: { statusCode?: number; code?: string; responseBody?: string; retryAfterSeconds?: number } = {}) {
    super(message, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class UploadError extends VexorError {
  readonly uploadUrl?: string;
  readonly offset?: number;

  constructor(message: string, options: { uploadUrl?: string; offset?: number; statusCode?: number; cause?: unknown } = {}) {
    super(message, { statusCode: options.statusCode, cause: options.cause });
    this.uploadUrl = options.uploadUrl;
    this.offset = options.offset;
  }
}

export class SignatureVerificationError extends VexorError {}
