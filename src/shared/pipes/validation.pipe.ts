// src/shared/pipes/validation.pipe.ts
import { ValidationPipe, BadRequestException } from '@nestjs/common';

// ── Global ValidationPipe config ──────────────────────────────────────────
// Used in main.ts: app.useGlobalPipes(createValidationPipe())
//
// whitelist:            strips unknown properties from request body
// forbidNonWhitelisted: throws 400 if unknown properties are present
// transform:            auto-converts strings to numbers, dates, etc.
// transformOptions:     implicit conversion (e.g. '20' → 20 for @IsInt())
//
// The custom exceptionFactory formats validation errors into our standard
// error envelope so Flutter/Next.js get consistent error shapes.

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist:            true,
    forbidNonWhitelisted: true,
    transform:            true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    exceptionFactory: (errors) => {
      const messages = errors.flatMap(error =>
        Object.values(error.constraints ?? {})
      );

      return new BadRequestException({
        statusCode: 400,
        code:       'VALIDATION_ERROR',
        message:    messages,
      });
    },
  });
}
