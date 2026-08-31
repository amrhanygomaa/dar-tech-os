import 'dotenv/config';
import {
  ConfigValidationError,
  loadApiConfig,
  loadWebConfig,
  loadWorkerConfig,
  toSafeConfigSummary,
} from '@dar-tech/config';

const runtime = process.argv[2] ?? 'api';

try {
  const config =
    runtime === 'api'
      ? loadApiConfig(process.env)
      : runtime === 'worker'
        ? loadWorkerConfig(process.env)
        : runtime === 'web'
          ? loadWebConfig(process.env)
          : undefined;

  if (!config) {
    throw new Error('Runtime must be api, worker, or web');
  }

  process.stdout.write(`${JSON.stringify(toSafeConfigSummary(config))}\n`);
} catch (error: unknown) {
  const message =
    error instanceof ConfigValidationError || error instanceof Error
      ? error.message
      : 'Configuration validation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
