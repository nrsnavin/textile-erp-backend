import { NestFactory }   from '@nestjs/core';
import { AppModule }     from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── CORS ─────────────────────────────────────────────────────────────
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin) return callback(null, true);
      // Allow any localhost / 127.0.0.1 port in development
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Allow configured WEB_URL in production
      const allowed = process.env.WEB_URL;
      if (allowed && origin === allowed) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Validation ──────────────────────────────────────────────────────
  app.useGlobalPipes(new ValidationPipe({
    whitelist:   true,
    transform:   true,
    forbidNonWhitelisted: true,
  }));

  // ── Swagger ─────────────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Textile ERP API')
    .setDescription('Backend API for Textile ERP')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // ── Start ────────────────────────────────────────────────────────────
  const port = process.env.PORT ?? 3008;
  await app.listen(port);

  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger UI:  http://localhost:${port}/api/docs`);
  console.log(`Health:      http://localhost:${port}/api/v1/health`);
}

bootstrap();