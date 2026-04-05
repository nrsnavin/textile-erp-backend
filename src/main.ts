import { NestFactory }   from '@nestjs/core';
import { AppModule }     from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── CORS ─────────────────────────────────────────────────────────────
  app.enableCors({
    origin: true,
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