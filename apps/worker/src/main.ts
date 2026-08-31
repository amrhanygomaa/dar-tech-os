import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ConfigValidationError,
  loadWorkerConfig,
  toSafeConfigSummary,
} from '@dar-tech/config';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config));
  app.enableShutdownHooks();
  const logger = new Logger('Bootstrap');
  logger.log({ configuration: toSafeConfigSummary(config) }, 'Configuration validated');
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof ConfigValidationError ? error.message : 'Worker startup failed safely';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
