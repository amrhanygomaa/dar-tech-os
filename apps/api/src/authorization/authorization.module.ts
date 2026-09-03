import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { AppEnvironment } from '@dar-tech/config';
import { PERMISSION_REPOSITORY_PORT } from '../permissions/permission.contracts.js';
import {
  CentralAuthenticatedActorAdapter,
  CentralEventHistoryAuthorizationAdapter,
  CentralIdentityAuthorizationAdapter,
  CentralInvitationAuthorizationAdapter,
  CentralPermissionAuthorizationAdapter,
  CentralRoleAuthorizationAdapter,
  CentralSessionAuthorizationAdapter,
} from './authorization.adapters.js';
import { AuthorizationActorContext } from './authorization-context.js';
import {
  AUTHORIZATION_CLOCK,
  AUTHORIZATION_EMERGENCY_ACCESS_PORT,
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_ACCESS_PORT,
  type AuthorizationClock,
  type AuthorizationEmergencyAccessPort,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationPolicyEvaluator,
  type AuthorizationScopeResolver,
  type AuthorizationTemporaryAccessPort,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyAccessAdapter,
  DefaultAuthorizationPolicyEvaluator,
  DefaultAuthorizationTemporaryAccessAdapter,
} from './authorization-extensions.js';
import { StructuredAuthorizationMetricsAdapter } from './authorization-metrics.js';
import { AuthorizationRequestMiddleware } from './authorization-request.middleware.js';
import { AuthorizationService } from './authorization.service.js';

export interface AuthorizationModuleExtensions {
  readonly scopeResolvers?: readonly AuthorizationScopeResolver[] | undefined;
  readonly temporaryAccess?: AuthorizationTemporaryAccessPort | undefined;
  readonly emergencyAccess?: AuthorizationEmergencyAccessPort | undefined;
  readonly policyEvaluator?: AuthorizationPolicyEvaluator | undefined;
}

export interface AuthorizationTestAdapters {
  readonly clock?: AuthorizationClock | undefined;
  readonly grants?: AuthorizationGrantRepository | undefined;
  readonly metrics?: AuthorizationMetricsPort | undefined;
  readonly scopeResolvers?: readonly AuthorizationScopeResolver[] | undefined;
  readonly temporaryAccess?: AuthorizationTemporaryAccessPort | undefined;
  readonly emergencyAccess?: AuthorizationEmergencyAccessPort | undefined;
  readonly policyEvaluator?: AuthorizationPolicyEvaluator | undefined;
}

export interface AuthorizationModuleRegistrationOptions {
  readonly extensions?: AuthorizationModuleExtensions | undefined;
  readonly testAdapters?: AuthorizationTestAdapters | undefined;
}

function isRegistrationOptions(
  options: AuthorizationModuleRegistrationOptions | AuthorizationTestAdapters,
): options is AuthorizationModuleRegistrationOptions {
  return 'extensions' in options || 'testAdapters' in options;
}

function selectedProvider(token: symbol, value: object | undefined, fallback: Provider): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Global()
@Module({})
export class AuthorizationModule {
  static register(
    environment: AppEnvironment,
    options?: AuthorizationModuleRegistrationOptions | AuthorizationTestAdapters,
  ): DynamicModule {
    const registrationOptions: AuthorizationModuleRegistrationOptions = options
      ? isRegistrationOptions(options)
        ? options
        : { testAdapters: options }
      : {};

    const testAdapters = registrationOptions.testAdapters;
    const extensions = registrationOptions.extensions;

    if (testAdapters && environment !== 'test') {
      throw new Error('Authorization test adapters are available only in the test environment');
    }

    return {
      module: AuthorizationModule,
      global: true,
      providers: [
        AuthorizationActorContext,
        selectedProvider(AUTHORIZATION_CLOCK, testAdapters?.clock, {
          provide: AUTHORIZATION_CLOCK,
          useValue: { now: () => new Date() },
        }),
        selectedProvider(AUTHORIZATION_GRANT_REPOSITORY, testAdapters?.grants, {
          provide: AUTHORIZATION_GRANT_REPOSITORY,
          useExisting: PERMISSION_REPOSITORY_PORT,
        }),
        selectedProvider(AUTHORIZATION_METRICS_PORT, testAdapters?.metrics, {
          provide: AUTHORIZATION_METRICS_PORT,
          useClass: StructuredAuthorizationMetricsAdapter,
        }),
        {
          provide: AUTHORIZATION_SCOPE_RESOLVERS,
          useValue: testAdapters?.scopeResolvers ?? extensions?.scopeResolvers ?? [],
        },
        selectedProvider(
          AUTHORIZATION_TEMPORARY_ACCESS_PORT,
          testAdapters?.temporaryAccess ?? extensions?.temporaryAccess,
          {
            provide: AUTHORIZATION_TEMPORARY_ACCESS_PORT,
            useClass: DefaultAuthorizationTemporaryAccessAdapter,
          },
        ),
        selectedProvider(
          AUTHORIZATION_EMERGENCY_ACCESS_PORT,
          testAdapters?.emergencyAccess ?? extensions?.emergencyAccess,
          {
            provide: AUTHORIZATION_EMERGENCY_ACCESS_PORT,
            useClass: DefaultAuthorizationEmergencyAccessAdapter,
          },
        ),
        selectedProvider(
          AUTHORIZATION_POLICY_EVALUATOR,
          testAdapters?.policyEvaluator ?? extensions?.policyEvaluator,
          {
            provide: AUTHORIZATION_POLICY_EVALUATOR,
            useClass: DefaultAuthorizationPolicyEvaluator,
          },
        ),
        AuthorizationService,
        AuthorizationRequestMiddleware,
        CentralAuthenticatedActorAdapter,
        CentralIdentityAuthorizationAdapter,
        CentralInvitationAuthorizationAdapter,
        CentralRoleAuthorizationAdapter,
        CentralPermissionAuthorizationAdapter,
        CentralEventHistoryAuthorizationAdapter,
        CentralSessionAuthorizationAdapter,
      ],
      exports: [
        AUTHORIZATION_CLOCK,
        AUTHORIZATION_SCOPE_RESOLVERS,
        AUTHORIZATION_TEMPORARY_ACCESS_PORT,
        AUTHORIZATION_EMERGENCY_ACCESS_PORT,
        AUTHORIZATION_POLICY_EVALUATOR,
        AuthorizationActorContext,
        AuthorizationService,
        AuthorizationRequestMiddleware,
        CentralAuthenticatedActorAdapter,
        CentralIdentityAuthorizationAdapter,
        CentralInvitationAuthorizationAdapter,
        CentralRoleAuthorizationAdapter,
        CentralPermissionAuthorizationAdapter,
        CentralEventHistoryAuthorizationAdapter,
        CentralSessionAuthorizationAdapter,
      ],
    };
  }
}
