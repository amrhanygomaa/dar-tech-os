import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AUTHORIZATION_TEMPORARY_GRANT_LOOKUP } from './authorization.contracts.js';
import type {
  AuthorizationGrant,
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
  constructor(@Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef) {}

  async listGrants(
    input: AuthorizationAlternateGrantSourceInput,
  ): Promise<readonly AuthorizationGrant[]> {
    let lookup: AuthorizationTemporaryGrantSource | undefined;
    try {
      lookup = this.moduleRef?.get<AuthorizationTemporaryGrantSource>(
        AUTHORIZATION_TEMPORARY_GRANT_LOOKUP,
        { strict: false },
      );
    } catch {
      // T07 can run without T10; an absent lookup contributes no descriptors.
      return [];
    }
    return lookup ? lookup.listGrants(input) : [];
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
