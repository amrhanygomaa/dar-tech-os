import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  ConfigValidationError,
  loadWorkerConfig,
  toSafeConfigSummary,
} from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const contextStore = new RequestContextStore();
  const logger = new StructuredLogger(contextStore, {
    runtime: 'worker',
    environment: config.appEnvironment,
    level: config.logLevel,
  });
  const app = await NestFactory.createApplicationContext(
    WorkerModule.register(config, { contextStore, logger }),
    { logger },
  );
  app.enableShutdownHooks();
  logger.info('application.configuration.validated', {
    configuration: toSafeConfigSummary(config),
  });
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof ConfigValidationError ? error.message : 'Worker startup failed safely';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
