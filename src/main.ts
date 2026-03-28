// src/main.ts
import { NestFactory }    from '@nestjs/core';
import { AppModule }      from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  await app.listen(3008);
  console.log('API running on http://localhost:3008');
}

bootstrap();