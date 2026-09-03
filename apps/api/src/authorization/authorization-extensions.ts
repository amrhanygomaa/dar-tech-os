import { Injectable } from '@nestjs/common';
import type {
  AuthorizationEmergencyAccessPort,
  AuthorizationPolicyEvaluator,
  AuthorizationPolicyInput,
  AuthorizationPolicyResult,
  AuthorizationTemporaryAccessPort,
  EmergencyAccessEvaluationInput,
  EmergencyAccessEvaluationResult,
  TemporaryAccessEvaluationInput,
  TemporaryAccessEvaluationResult,
} from './authorization.contracts.js';

@Injectable()
export class DefaultAuthorizationTemporaryAccessAdapter implements AuthorizationTemporaryAccessPort {
  async evaluate(
    _input: TemporaryAccessEvaluationInput,
  ): Promise<TemporaryAccessEvaluationResult> {
    // Default implementation contributes NO authority (deferred to T10).
    return { granted: false };
  }
}

@Injectable()
export class DefaultAuthorizationEmergencyAccessAdapter implements AuthorizationEmergencyAccessPort {
  async evaluate(
    _input: EmergencyAccessEvaluationInput,
  ): Promise<EmergencyAccessEvaluationResult> {
    // Default implementation contributes NO authority; no universal bypass (deferred to T11).
    return { granted: false };
  }
}

@Injectable()
export class DefaultAuthorizationPolicyEvaluator implements AuthorizationPolicyEvaluator {
  async evaluatePolicy(
    _input: AuthorizationPolicyInput,
  ): Promise<AuthorizationPolicyResult> {
    // Default preserves current role-permission authorization without inventing approval/step-up rules (deferred to T09).
    return { allowed: true };
  }
}
