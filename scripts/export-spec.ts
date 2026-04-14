/**
 * Standalone script that boots the NestJS app (without DB connection via
 * SPEC_EXPORT=1 env flag), extracts the OpenAPI document, writes it to
 * openapi.json, then exits cleanly.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/export-spec.ts
 *
 * The DATABASE_URL env var must point to a reachable Postgres instance so
 * Prisma can initialise. In CI, spin up a throw-away Postgres first.
 * For local dev the normal dev DB is fine.
 */

import { NestFactory }     from '@nestjs/core';
import { ValidationPipe }  from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs             from 'fs';
import * as path           from 'path';

// Signal PrismaService to skip $connect() so no live DB is needed.
process.env['SPEC_EXPORT'] = '1';

// Imported last so the module graph resolves correctly when run via ts-node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('../src/app.module');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  const config = new DocumentBuilder()
    .setTitle('Textile ERP API')
    .setDescription('Backend API for Textile ERP')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const outPath = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2));
  console.log(`✓ OpenAPI spec exported to ${outPath}`);

  await app.close();
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
