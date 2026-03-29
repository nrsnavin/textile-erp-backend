// src/shared/filters/global-exception.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma }            from '@prisma/client';

// ── GlobalExceptionFilter ──────────────────────────────────────────────────
// Catches ALL exceptions and formats them into the standard error envelope:
// { data: null, meta: null, errors: { statusCode, message, code, path, timestamp } }
//
// Handles:
//   - NestJS HttpException (400, 401, 403, 404, 409, 422, 429...)
//   - Prisma errors (P2002 unique, P2025 not found, P2003 FK violation)
//   - Unhandled runtime errors (500)

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    const { status, message, code } = this.resolveException(exception);

    const errorBody = {
      data:   null,
      meta:   null,
      errors: {
        statusCode: status,
        message,
        code,
        path:      request.url,
        timestamp: new Date().toISOString(),
      },
    };

    // Log server errors with full stack trace
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}: ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(
        `${request.method} ${request.url} → ${status}: ${message}`
      );
    }

    response.status(status).json(errorBody);
  }

  private resolveException(exception: unknown): {
    status:  number;
    message: string;
    code:    string;
  } {
    // ── NestJS HTTP Exception ────────────────────────────────────────────
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status   = exception.getStatus();

      if (typeof response === 'string') {
        return { status, message: response, code: this.statusToCode(status) };
      }

      if (typeof response === 'object') {
        const res = response as any;
        // class-validator returns { message: string[] } for validation errors
        const message = Array.isArray(res.message)
          ? res.message.join('. ')
          : res.message ?? exception.message;
        return { status, message, code: res.code ?? this.statusToCode(status) };
      }
    }

    // ── Prisma Errors ────────────────────────────────────────────────────
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status:  HttpStatus.BAD_REQUEST,
        message: 'Invalid data format in database query.',
        code:    'VALIDATION_ERROR',
      };
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      return {
        status:  HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'A database error occurred.',
        code:    'DATABASE_ERROR',
      };
    }

    // ── Unknown / Runtime Error ──────────────────────────────────────────
    const message = exception instanceof Error
      ? exception.message
      : 'An unexpected error occurred. Please try again.';

    return {
      status:  HttpStatus.INTERNAL_SERVER_ERROR,
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error.'
        : message,
      code: 'INTERNAL_ERROR',
    };
  }

  private handlePrismaError(err: Prisma.PrismaClientKnownRequestError): {
    status:  number;
    message: string;
    code:    string;
  } {
    switch (err.code) {
      case 'P2002': {
        // Unique constraint violation
        const fields = (err.meta?.target as string[])?.join(', ') ?? 'field';
        return {
          status:  HttpStatus.CONFLICT,
          message: `A record with this ${fields} already exists.`,
          code:    'DUPLICATE_ENTRY',
        };
      }
      case 'P2025':
        // Record not found
        return {
          status:  HttpStatus.NOT_FOUND,
          message: 'Record not found.',
          code:    'NOT_FOUND',
        };
      case 'P2003':
        // Foreign key constraint failed
        return {
          status:  HttpStatus.BAD_REQUEST,
          message: 'Referenced record does not exist.',
          code:    'FOREIGN_KEY_VIOLATION',
        };
      case 'P2014':
        // Required relation violation
        return {
          status:  HttpStatus.BAD_REQUEST,
          message: 'Cannot delete — related records exist.',
          code:    'RELATION_VIOLATION',
        };
      default:
        return {
          status:  HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred.',
          code:    `PRISMA_${err.code}`,
        };
    }
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
