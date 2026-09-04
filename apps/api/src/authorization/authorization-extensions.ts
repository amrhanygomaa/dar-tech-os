import { Injectable } from '@nestjs/common';
import type {
  AuthorizationEmergencyGrantSource,
  AuthorizationPolicyEvaluator,
  AuthorizationPolicyInput,
  AuthorizationPolicyResult,
  AuthorizationTemporaryGrantSource,
  AuthorizationAlternateGrantSourceInput,
} from './authorization.contracts.js';

/** T10 owns any real temporary-access lookup; T07 contributes no grants. */
@Injectable()
export class DefaultAuthorizationTemporaryGrantSource
  implements AuthorizationTemporaryGrantSource
{
  async listGrants(
    _input: AuthorizationAlternateGrantSourceInput,
  ): Promise<readonly []> {
    return [];
  }
}

/** T11 owns any real emergency-access lookup; T07 contributes no grants. */
@Injectable()
export class DefaultAuthorizationEmergencyGrantSource
  implements AuthorizationEmergencyGrantSource
{
  async listGrants(
    _input: AuthorizationAlternateGrantSourceInput,
  ): Promise<readonly []> {
    return [];
  }
}

/** T09 will own policy outcomes; the T07 default adds no new policy behavior. */
@Injectable()
export class DefaultAuthorizationPolicyEvaluator implements AuthorizationPolicyEvaluator {
  async evaluatePolicy(_input: AuthorizationPolicyInput): Promise<AuthorizationPolicyResult> {
    return { allowed: true };
  }
}
