import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sanitizeErrorMessage } from '../security/redaction.js';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const reqId = `req_${crypto.randomBytes(6).toString('hex')}`;
  res.locals.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        ...(requestId ? { request_id: requestId } : {}),
      },
    });
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds maximum allowed size',
        ...(requestId ? { request_id: requestId } : {}),
      },
    });
    return;
  }

  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON in request body',
        ...(requestId ? { request_id: requestId } : {}),
      },
    });
    return;
  }

  const safeMsg = sanitizeErrorMessage(err);
  console.error(`[HookRelay] Unhandled error (${requestId ?? 'no-id'}):`, safeMsg);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred',
      ...(requestId ? { request_id: requestId } : {}),
    },
  });
}
