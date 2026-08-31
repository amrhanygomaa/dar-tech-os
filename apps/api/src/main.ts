import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ConfigValidationError,
  loadApiConfig,
  toSafeConfigSummary,
} from '@dar-tech/config';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config));
  app.setGlobalPrefix('api/v1');

  const logger = new Logger('Bootstrap');
  logger.log({ configuration: toSafeConfigSummary(config) }, 'Configuration validated');
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof ConfigValidationError ? error.message : 'API startup failed safely';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
