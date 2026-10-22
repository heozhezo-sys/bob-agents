export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Not found") => new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const payloadTooLarge = (message: string) =>
  new AppError(413, "payload_too_large", message);
export const unsupportedMedia = (message: string) =>
  new AppError(415, "unsupported_media_type", message);
export const tooManyRequests = (message = "Too many requests") =>
  new AppError(429, "rate_limited", message);
export const internal = (message = "Something went wrong") =>
  new AppError(500, "internal_error", message);
