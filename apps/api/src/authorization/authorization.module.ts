import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
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
  AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
  AUTHORIZATION_GRANT_REPOSITORY,
  AUTHORIZATION_METRICS_PORT,
  AUTHORIZATION_POLICY_EVALUATOR,
  AUTHORIZATION_RESOLVER_METRICS_PORT,
  AUTHORIZATION_SCOPE_RESOLVER_REGISTRY,
  AUTHORIZATION_SCOPE_RESOLVERS,
  AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
  type AuthorizationClock,
  type AuthorizationEmergencyGrantSource,
  type AuthorizationGrantRepository,
  type AuthorizationMetricsPort,
  type AuthorizationPolicyEvaluator,
  type AuthorizationResolverMetricsPort,
  type AuthorizationScopeResolver,
  type AuthorizationTemporaryGrantSource,
} from './authorization.contracts.js';
import {
  DefaultAuthorizationEmergencyGrantSource,
  DefaultAuthorizationTemporaryGrantSource,
} from './authorization-extensions.js';
import {
  StructuredAuthorizationMetricsAdapter,
  StructuredAuthorizationResolverMetricsAdapter,
} from './authorization-metrics.js';
import { AuthorizationRequestMiddleware } from './authorization-request.middleware.js';
import { AuthorizationScopeResolverRegistry } from './authorization-scope-resolver.registry.js';
import { AuthorizationService } from './authorization.service.js';
import {
  APPROVAL_POLICY_RESOLVER,
  STEP_UP_EVIDENCE_EVALUATOR,
  type ApprovalPolicyResolver,
} from '../approvals/approval.contracts.js';
import {
  CompatibilityApprovalPolicyResolver,
  TrustedSessionStepUpEvidenceEvaluator,
} from '../approvals/approval-policy.js';
import { ApprovalAuthorizationPolicyEvaluator } from '../approvals/approval-authorization-policy.js';

export interface AuthorizationTestAdapters {
  readonly clock?: AuthorizationClock;
  readonly grants?: AuthorizationGrantRepository;
  readonly metrics?: AuthorizationMetricsPort;
  readonly resolverMetrics?: AuthorizationResolverMetricsPort;
  readonly scopeResolvers?: readonly AuthorizationScopeResolver[];
  readonly temporaryGrantSource?: AuthorizationTemporaryGrantSource;
  readonly emergencyGrantSource?: AuthorizationEmergencyGrantSource;
  readonly policyEvaluator?: AuthorizationPolicyEvaluator;
  readonly approvalPolicyResolver?: ApprovalPolicyResolver;
}

export interface AuthorizationModuleExtensions {
  readonly temporaryGrantSource?: AuthorizationTemporaryGrantSource;
  readonly emergencyGrantSource?: AuthorizationEmergencyGrantSource;
  readonly policyEvaluator?: AuthorizationPolicyEvaluator;
  readonly approvalPolicyResolver?: ApprovalPolicyResolver;
}

export interface AuthorizationModuleRegistrationOptions {
  readonly extensions?: AuthorizationModuleExtensions;
  readonly testAdapters?: AuthorizationTestAdapters;
}

function selectedProvider(token: symbol, value: object | undefined, fallback: Provider): Provider {
  return value ? { provide: token, useValue: value } : fallback;
}

@Global()
@Module({})
export class AuthorizationModule {
  static register(
    environment: AppEnvironment,
    options: AuthorizationModuleRegistrationOptions = {},
  ): DynamicModule {
    const { extensions, testAdapters } = options;
    if (testAdapters && environment !== 'test') {
      throw new Error('Authorization test adapters are available only in the test environment');
    }
    return {
      module: AuthorizationModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        CompatibilityApprovalPolicyResolver,
        selectedProvider(
          APPROVAL_POLICY_RESOLVER,
          testAdapters?.approvalPolicyResolver ?? extensions?.approvalPolicyResolver,
          { provide: APPROVAL_POLICY_RESOLVER, useExisting: CompatibilityApprovalPolicyResolver },
        ),
        TrustedSessionStepUpEvidenceEvaluator,
        { provide: STEP_UP_EVIDENCE_EVALUATOR, useExisting: TrustedSessionStepUpEvidenceEvaluator },
        ApprovalAuthorizationPolicyEvaluator,
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
          useValue: testAdapters?.scopeResolvers ?? [],
        },
        selectedProvider(AUTHORIZATION_RESOLVER_METRICS_PORT, testAdapters?.resolverMetrics, {
          provide: AUTHORIZATION_RESOLVER_METRICS_PORT,
          useClass: StructuredAuthorizationResolverMetricsAdapter,
        }),
        AuthorizationScopeResolverRegistry,
        {
          provide: AUTHORIZATION_SCOPE_RESOLVER_REGISTRY,
          useExisting: AuthorizationScopeResolverRegistry,
        },
        selectedProvider(
          AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
          testAdapters?.temporaryGrantSource ?? extensions?.temporaryGrantSource,
          {
            provide: AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
            useClass: DefaultAuthorizationTemporaryGrantSource,
          },
        ),
        selectedProvider(
          AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
          testAdapters?.emergencyGrantSource ?? extensions?.emergencyGrantSource,
          {
            provide: AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
            useClass: DefaultAuthorizationEmergencyGrantSource,
          },
        ),
        selectedProvider(
          AUTHORIZATION_POLICY_EVALUATOR,
          testAdapters?.policyEvaluator ?? extensions?.policyEvaluator,
          {
            provide: AUTHORIZATION_POLICY_EVALUATOR,
            useExisting: ApprovalAuthorizationPolicyEvaluator,
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
        AUTHORIZATION_SCOPE_RESOLVER_REGISTRY,
        AUTHORIZATION_TEMPORARY_GRANT_SOURCE,
        AUTHORIZATION_EMERGENCY_GRANT_SOURCE,
        AUTHORIZATION_POLICY_EVALUATOR,
        APPROVAL_POLICY_RESOLVER,
        STEP_UP_EVIDENCE_EVALUATOR,
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
