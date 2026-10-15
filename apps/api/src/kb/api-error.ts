import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Domain error with a stable machine code (contracts/rest-api.md: `{ error: { code, message } }`). */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ error: { code, message, details } }, status);
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('api');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof ApiError) return res.status(err.getStatus()).json(err.getResponse());
    if (err instanceof ZodError) {
      return res.status(400).json({ error: { code: 'invalid_body', message: 'invalid request', details: err.issues } });
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const code = status === 413 ? 'too_large' : status === 404 ? 'not_found' : 'http_error';
      return res.status(status).json({ error: { code, message: err.message } });
    }
    this.logger.error(err);
    return res.status(500).json({ error: { code: 'internal', message: err instanceof Error ? err.message : 'internal error' } });
  }
}
