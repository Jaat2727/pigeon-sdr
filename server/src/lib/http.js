/**
 * HTTP helpers.
 *
 * `asyncHandler` is the reason no route in this codebase writes
 * `if (error) return res.status(500)`. Route handlers throw; this forwards to
 * the central error middleware, which shapes every failure the same way.
 */

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message, details) => new ApiError(409, 'conflict', message, details);

/**
 * Central error middleware. Postgres error codes are translated into the HTTP
 * status a client can act on, and the stack is only exposed outside production.
 */
export function errorHandler(err, req, res, _next) {
  const pgStatus = {
    '23505': 409, // unique_violation
    '23503': 409, // foreign_key_violation
    '23502': 400, // not_null_violation
    '22P02': 400, // invalid_text_representation (bad uuid)
    '42P01': 503, // undefined_table — migration not applied
    '42703': 503, // undefined_column — migration not applied
    PGRST116: 404,
  }[err.code];

  const status = err.status ?? pgStatus ?? 500;

  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  const body = {
    error: err.code ?? 'internal_error',
    message: err.message ?? 'Something went wrong',
  };

  if (err.code === '42P01' || err.code === '42703') {
    body.message =
      `${err.message}. This usually means the database migration has not been applied. ` +
      'Run server/db/migrations/004-pigeon-sdr-fixes.sql in the Supabase SQL editor.';
  }

  if (err.details) body.details = err.details;
  if (process.env.NODE_ENV !== 'production' && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'route_not_found',
    message: `No route matches ${req.method} ${req.originalUrl}`,
  });
}

/** Parses `?limit=` with a default and a hard ceiling. */
export function parseLimit(value, fallback = 50, max = 500) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
