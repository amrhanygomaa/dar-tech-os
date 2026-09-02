import type { RuntimeName } from '@dar-tech/types';

export {
  ConfigValidationError,
  loadApiConfig,
  loadWebConfig,
  loadWorkerConfig,
  type ApiConfig,
  type AppEnvironment,
  type AuthenticationConfig,
  type InvitationConfig,
  type LocalAuthenticationIdentityConfig,
  type LogLevel,
  type WebConfig,
  type WorkerConfig,
} from './runtime-config.js';
export {
  REDACTED_VALUE,
  SENSITIVE_KEY_PATTERNS,
  redactSensitiveValues,
  toSafeConfigSummary,
  type SafeConfigSummary,
} from './safe-config.js';

export const DEFAULT_PORTS: Readonly<Record<RuntimeName, number | null>> = {
  api: 3001,
  web: 3000,
  worker: null,
};
