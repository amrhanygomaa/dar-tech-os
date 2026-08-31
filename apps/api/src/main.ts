import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_PORTS } from '@dar-tech/config';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  const port = Number(process.env.API_PORT ?? DEFAULT_PORTS.api);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
