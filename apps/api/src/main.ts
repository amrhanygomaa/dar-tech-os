import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  ConfigValidationError,
  loadApiConfig,
  toSafeConfigSummary,
} from '@dar-tech/config';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { AppModule } from './app.module.js';
import { configureApiFoundation } from './platform/configure-api-foundation.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const contextStore = new RequestContextStore();
  const logger = new StructuredLogger(contextStore, {
    runtime: 'api',
    environment: config.appEnvironment,
    level: config.logLevel,
  });
  const app = await NestFactory.create(
    AppModule.register(config, { contextStore, logger }),
    { logger },
  );
  app.enableShutdownHooks();
  configureApiFoundation(app, contextStore, logger);
  logger.info('application.configuration.validated', {
    configuration: toSafeConfigSummary(config),
  });
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof ConfigValidationError ? error.message : 'API startup failed safely';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
