import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseTransaction } from '@dar-tech/database';
import { REQUEST_CONTEXT_STORE, type RequestContextStore } from '@dar-tech/observability';
import {
  APPROVAL_POLICY_RESOLVER,
  STEP_UP_EVIDENCE_EVALUATOR,
  type ApprovalPolicyResolver,
  type StepUpEvidenceEvaluator,
  type ValidatedApprovalPolicy,
} from '../approvals/approval.contracts.js';
import { boundedApprovalPolicyInput } from '../approvals/approval-input.js';
import { approvalFingerprint, validateApprovalPolicy } from '../approvals/approval-policy.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuthorizationActorContext } from '../authorization/authorization-context.js';
import {
  AUTHORIZATION_CLOCK,
  type AuthorizationActor,
  type AuthorizationClock,
  type AuthorizationDecision,
  type AuthorizationResource,
} from '../authorization/authorization.contracts.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import type { EventRisk } from '../event-history/event-history.contracts.js';
import { canonicalPermissionDefinition } from '../permissions/permission-manifest.js';
import {
  EMERGENCY_ACCESS_ALERT_HOOK,
  EMERGENCY_ACCESS_CONFIG,
  EMERGENCY_ACCESS_REPOSITORY,
  type EmergencyAccessAlertHook,
  type EmergencyAccessGrantView,
  type EmergencyAccessMaterialUseRecorder,
  type EmergencyAccessPage,
  type EmergencyAccessRepositoryPort,
  type EmergencyAccessRuntimeConfig,
} from './emergency-access.contracts.js';
import {
  emergencyAccessAuthenticationRequired,
  emergencyAccessConflict,
  emergencyAccessDenied,
  emergencyAccessNotFound,
  emergencyAccessStepUpRequired,
} from './emergency-access.errors.js';
import {
  emergencySafeContext,
  emergencySha256,
  parseEmergencyAccessId,
  parseEmergencyAccessList,
  parseEmergencyAccessRequest,
  riskMaximum,
} from './emergency-access-input.js';
import { EmergencyAccessMetrics } from './emergency-access-metrics.js';

@Injectable()
export class EmergencyAccessService implements EmergencyAccessMaterialUseRecorder {
  constructor(
    @Inject(AuthorizationActorContext) private readonly actors: AuthorizationActorContext,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(APPROVAL_POLICY_RESOLVER) private readonly policies: ApprovalPolicyResolver,
    @Inject(STEP_UP_EVIDENCE_EVALUATOR) private readonly stepUp: StepUpEvidenceEvaluator,
    @Inject(AUTHORIZATION_CLOCK) private readonly clock: AuthorizationClock,
    @Inject(EMERGENCY_ACCESS_CONFIG) private readonly config: EmergencyAccessRuntimeConfig,
    @Inject(EMERGENCY_ACCESS_REPOSITORY) private readonly repository: EmergencyAccessRepositoryPort,
    @Inject(REQUEST_CONTEXT_STORE) private readonly context: RequestContextStore,
    @Inject(EmergencyAccessMetrics) private readonly metrics: EmergencyAccessMetrics,
    @Inject(EMERGENCY_ACCESS_ALERT_HOOK) private readonly alerts: EmergencyAccessAlertHook,
  ) {}

  async request(body: unknown, idempotencyKey: unknown): Promise<EmergencyAccessGrantView> {
    const actor = this.requireActor();
    const at = this.clock.now();
    const parsed = parseEmergencyAccessRequest(body, idempotencyKey, at, this.config.maxDurationSeconds);
    const requester = await this.repository.findSubject(actor.organizationId, actor.employeeId);
    const recipient = await this.repository.findSubject(actor.organizationId, parsed.recipientEmployeeId);
    if (!recipient) throw emergencyAccessNotFound();
    if (!requester?.active || !recipient.active) throw emergencyAccessDenied();
    const bindings = parsed.bindings.map((binding) => {
      const definition = canonicalPermissionDefinition(binding.permissionKey);
      if (!definition) throw emergencyAccessDenied();
      return { ...binding, riskClassification: definition.riskClassification };
    });
    const emergencyRisk = canonicalPermissionDefinition('admin.access.emergency')!.riskClassification;
    const effectiveRisk = riskMaximum([parsed.requestedRisk, emergencyRisk, ...bindings.map((binding) => binding.riskClassification)]);
    const idempotencyDigest = emergencySha256(actor.organizationId, actor.employeeId, parsed.idempotencyKey);
    const correlationId = this.context.get()?.correlationId ?? randomUUID();
    const managementDecision = await this.requireRequestAuthority(actor, at);

    const grant = await this.repository.transaction(async (transaction) => {
      await this.repository.lockIdempotency(transaction, idempotencyDigest);
      const existing = await this.repository.findByIdempotency(actor.organizationId, idempotencyDigest, at, transaction);
      const id = existing?.id ?? randomUUID();
      const resource: AuthorizationResource = { type: 'emergency-access-grant', organizationId: actor.organizationId, id };
      const safeContext = emergencySafeContext({
        grantId: id,
        recipientEmployeeId: parsed.recipientEmployeeId,
        reason: parsed.reason,
        requestedRisk: parsed.requestedRisk,
        effectiveRisk,
        startsAt: parsed.startsAt,
        expiresAt: parsed.expiresAt,
        bindings,
      });
      const policy = await this.requireEmergencyPolicy(actor, resource, effectiveRisk, safeContext, at);
      if (this.stepUp.evaluate({ actor, requirement: policy.stepUpRequirement!, at }) !== 'SATISFIED') throw emergencyAccessStepUpRequired();
      const contextFingerprint = approvalFingerprint(safeContext);
      const requestFingerprint = emergencySha256(
        actor.organizationId,
        actor.employeeId,
        parsed.recipientEmployeeId,
        parsed.reason,
        parsed.requestedRisk,
        effectiveRisk,
        parsed.startsAt.toISOString(),
        parsed.expiresAt.toISOString(),
        JSON.stringify(bindings),
        policy.policyKey,
        String(policy.policyVersion),
        policy.fingerprint,
        contextFingerprint,
      );
      if (existing) {
        const row = await transaction.emergencyAccessGrant.findUnique({ where: { id: existing.id }, select: { requestFingerprint: true } });
        if (!row || row.requestFingerprint !== requestFingerprint) throw emergencyAccessConflict();
        return this.withActions(actor, existing, at);
      }
      const prepared = await this.approvals.prepareApprovalForAction({
        actor,
        action: 'admin.access.emergency',
        resource,
        risk: effectiveRisk,
        safeContext,
        requesterSnapshot: { displayName: requester.displayName },
        resourceSnapshot: { displayName: recipient.displayName },
        safeReason: parsed.reason,
        correlationId,
        idempotencyMaterial: idempotencyDigest,
        at,
      }, transaction);
      if (prepared.outcome === 'STEP_UP_REQUIRED') throw emergencyAccessStepUpRequired();
      if (prepared.outcome === 'NO_APPROVAL') throw emergencyAccessDenied();
      const approvalReference = prepared.outcome === 'APPROVAL_REQUIRED' ? prepared.request.id : null;
      const created = await this.repository.create({
        id,
        actor,
        requester,
        recipient,
        reason: parsed.reason,
        requestedRisk: parsed.requestedRisk,
        effectiveRisk,
        startsAt: parsed.startsAt,
        expiresAt: parsed.expiresAt,
        bindings,
        policy,
        stepUpVerifiedAt: actor.lastStepUpAt!,
        idempotencyDigest,
        requestFingerprint,
        contextFingerprint,
        approvalReference,
        correlationId,
        at,
      }, transaction);
      await this.recordIfMaterial({ decision: managementDecision, actor, action: 'admin.access.emergency', resource, correlationId, at, transaction });
      return this.withActions(actor, created, at);
    });
    this.metrics.record('requested', grant.effectiveRisk);
    await this.notify('requested', grant.effectiveRisk, 'succeeded');
    return grant;
  }

  async activate(idInput: string): Promise<{ readonly outcome: 'activated' | 'idempotent'; readonly grant: EmergencyAccessGrantView }> {
    const actor = this.requireActor();
    const id = parseEmergencyAccessId(idInput);
    const at = this.clock.now();
    const grant = await this.repository.findById(actor.organizationId, id, at);
    if (!grant) throw emergencyAccessNotFound();
    const correlationId = this.context.get()?.correlationId ?? randomUUID();
    if (grant.requesterEmployeeId !== actor.employeeId) return this.denyActivation(actor, grant, 'REQUESTER_MISMATCH', false, correlationId, at);
    if (at < grant.startsAt) return this.denyActivation(actor, grant, 'ACTIVATION_WINDOW_NOT_STARTED', false, correlationId, at);
    if (at >= grant.expiresAt) return this.denyActivation(actor, grant, 'ACTIVATION_WINDOW_EXPIRED', true, correlationId, at);
    if (['DENIED', 'REVOKED', 'EXPIRED'].includes(grant.storedStatus)) return this.denyActivation(actor, grant, 'TERMINAL_STATE', false, correlationId, at);
    const recipient = await this.repository.findSubject(actor.organizationId, grant.recipientEmployeeId);
    if (!recipient?.active) return this.denyActivation(actor, grant, 'RECIPIENT_INELIGIBLE', false, correlationId, at);
    const safeContext = this.safeContextFromGrant(grant);
    const resource: AuthorizationResource = { type: 'emergency-access-grant', organizationId: actor.organizationId, id };
    const policy = await this.currentMatchingPolicy(actor, grant, resource, safeContext, at);
    if (!policy) return this.denyActivation(actor, grant, 'POLICY_INVALID_OR_STALE', false, correlationId, at);
    if (this.stepUp.evaluate({ actor, requirement: policy.stepUpRequirement!, at }) !== 'SATISFIED') return this.denyActivation(actor, grant, 'STEP_UP_REQUIRED', false, correlationId, at, true);
    const decision = await this.authorization.authorize(actor, 'admin.access.emergency', resource, {
      at,
      source: 'http',
      ...(grant.approvalReference ? { approvalReference: grant.approvalReference } : {}),
      approvalContext: safeContext,
    });
    if (!decision.allowed) return this.denyActivation(actor, grant, decision.reasonCode, false, correlationId, at, decision.reasonCode === 'STEP_UP_REQUIRED');

    const result = await this.repository.transaction(async (transaction) => {
      const current = await this.repository.findById(actor.organizationId, id, at, transaction);
      if (!current) throw emergencyAccessNotFound();
      if (current.storedStatus === 'ACTIVE') return { outcome: 'idempotent' as const, grant: current };
      let claimVersion: number | null = null;
      if (current.approvalReference) {
        const claim = await this.approvals.claimApprovedAction({
          actor,
          approvalReference: current.approvalReference,
          action: 'admin.access.emergency',
          resource,
          risk: current.effectiveRisk,
          safeContext,
          correlationId,
          at,
        }, transaction);
        if (claim.status !== 'claimed') {
          if (claim.status === 'already_processing') throw emergencyAccessConflict();
          throw emergencyAccessDenied();
        }
        claimVersion = claim.claimVersion;
      }
      const activated = await this.repository.activate({
        organizationId: actor.organizationId,
        id,
        actorEmployeeId: actor.employeeId,
        approvalReference: current.approvalReference,
        correlationId,
        stepUpVerifiedAt: actor.lastStepUpAt!,
        at,
      }, transaction);
      if (claimVersion !== null && current.approvalReference) {
        await this.approvals.completeApprovedAction({
          claimVersion,
          organizationId: actor.organizationId,
          approvalReference: current.approvalReference,
          resultReference: `emergency-access-grant:${id}`,
          correlationId,
          at,
        }, transaction);
      }
      await this.recordIfMaterial({ decision, actor, action: 'admin.access.emergency', resource, correlationId, at, transaction });
      return activated;
    });
    this.metrics.record('activation_success', result.grant.effectiveRisk);
    await this.notify('activated', result.grant.effectiveRisk, 'succeeded');
    return { ...result, grant: await this.withActions(actor, result.grant, at) };
  }

  async list(page?: string, pageSize?: string, status?: string, recipientEmployeeId?: string, risk?: string): Promise<EmergencyAccessPage> {
    const actor = this.requireActor();
    const input = parseEmergencyAccessList(page, pageSize, status, recipientEmployeeId, risk);
    const at = this.clock.now();
    const decision = await this.authorization.authorize(actor, 'admin.access.emergency', { type: 'emergency-access-grant', organizationId: actor.organizationId }, { at, source: 'http' });
    if (!decision.allowed || decision.matchedGrant?.scopeType !== 'ORGANIZATION') throw emergencyAccessDenied();
    const result = await this.repository.list({ organizationId: actor.organizationId, ...input, at });
    return { ...result, items: await Promise.all(result.items.map((grant) => this.withActions(actor, grant, at))) };
  }

  async detail(idInput: string): Promise<EmergencyAccessGrantView> {
    const actor = this.requireActor();
    const id = parseEmergencyAccessId(idInput);
    const at = this.clock.now();
    await this.requireManagement(actor, id, at);
    const grant = await this.repository.findById(actor.organizationId, id, at);
    if (!grant) throw emergencyAccessNotFound();
    return this.withActions(actor, grant, at);
  }

  async revoke(idInput: string): Promise<{ readonly outcome: 'revoked' | 'idempotent'; readonly grant: EmergencyAccessGrantView }> {
    const actor = this.requireActor();
    const id = parseEmergencyAccessId(idInput);
    const at = this.clock.now();
    const resource: AuthorizationResource = { type: 'emergency-access-grant', organizationId: actor.organizationId, id };
    const decision = await this.authorization.authorize(actor, 'admin.access.revoke', resource, { at, source: 'http' });
    if (!decision.allowed) throw emergencyAccessDenied();
    const correlationId = this.context.get()?.correlationId ?? randomUUID();
    const result = await this.repository.transaction(async (transaction) => {
      const revoked = await this.repository.revoke({ organizationId: actor.organizationId, id, actorEmployeeId: actor.employeeId, correlationId, at }, transaction);
      if (!revoked.grant || revoked.outcome === 'not_found') throw emergencyAccessNotFound();
      await this.recordIfMaterial({ decision, actor, action: 'admin.access.revoke', resource, correlationId, at, transaction });
      return revoked as { readonly outcome: 'revoked' | 'idempotent'; readonly grant: EmergencyAccessGrantView };
    });
    this.metrics.record(result.grant.status === 'EXPIRED' ? 'expired' : 'revoked', result.grant.effectiveRisk);
    await this.notify(result.grant.status === 'EXPIRED' ? 'expired' : 'revoked', result.grant.effectiveRisk, 'succeeded');
    return { ...result, grant: await this.withActions(actor, result.grant, at) };
  }

  async recordIfMaterial(input: { readonly decision: AuthorizationDecision; readonly actor: AuthorizationActor; readonly action: string; readonly resource: AuthorizationResource; readonly correlationId: string; readonly at: Date; readonly transaction: DatabaseTransaction }): Promise<boolean> {
    if (!input.decision.allowed || input.decision.matchedGrant?.source !== 'EMERGENCY' || !input.decision.matchedGrant.sourceReference) return false;
    const recorded = await this.repository.recordMaterialUse({ organizationId: input.actor.organizationId, grantId: input.decision.matchedGrant.sourceReference, actor: input.actor, action: input.action, resource: input.resource, correlationId: input.correlationId, at: input.at }, input.transaction);
    if (recorded) {
      this.metrics.record('used', input.decision.matchedGrant.riskClassification);
      await this.notify('used', input.decision.matchedGrant.riskClassification, 'succeeded');
    }
    return recorded;
  }

  private requireActor(): AuthorizationActor {
    const actor = this.actors.currentActor();
    if (!actor) throw emergencyAccessAuthenticationRequired();
    return actor;
  }

  private async requireManagement(actor: AuthorizationActor, id: string | undefined, at: Date): Promise<AuthorizationDecision> {
    const decision = await this.authorization.authorize(actor, 'admin.access.emergency', { type: 'emergency-access-grant', organizationId: actor.organizationId, ...(id ? { id } : {}) }, { at, source: 'http' });
    if (!decision.allowed) {
      if (decision.reasonCode === 'STEP_UP_REQUIRED') throw emergencyAccessStepUpRequired();
      throw emergencyAccessDenied();
    }
    return decision;
  }

  private async requireRequestAuthority(actor: AuthorizationActor, at: Date): Promise<AuthorizationDecision> {
    const decision = await this.authorization.authorize(actor, 'admin.access.emergency', { type: 'emergency-access-grant', organizationId: actor.organizationId }, { at, source: 'http' });
    if (!decision.allowed && !['APPROVAL_REQUIRED', 'STEP_UP_REQUIRED'].includes(decision.reasonCode)) throw emergencyAccessDenied();
    return decision;
  }

  private async requireEmergencyPolicy(actor: AuthorizationActor, resource: AuthorizationResource, risk: EventRisk, safeContext: Readonly<Record<string, string>>, at: Date): Promise<ValidatedApprovalPolicy> {
    let raw: unknown;
    try {
      raw = await this.policies.resolvePolicy(boundedApprovalPolicyInput({ actor, action: 'admin.access.emergency', resource, risk, context: safeContext, at }));
    } catch {
      throw emergencyAccessDenied();
    }
    const policy = validateApprovalPolicy(raw, risk);
    if (!policy || !['STEP_UP_ONLY', 'STEP_UP_AND_APPROVAL'].includes(policy.outcome) || !policy.stepUpRequirement) throw emergencyAccessDenied();
    return policy;
  }

  private async currentMatchingPolicy(actor: AuthorizationActor, grant: EmergencyAccessGrantView, resource: AuthorizationResource, safeContext: Readonly<Record<string, string>>, at: Date): Promise<ValidatedApprovalPolicy | null> {
    try {
      const policy = await this.requireEmergencyPolicy(actor, resource, grant.effectiveRisk, safeContext, at);
      return policy.policyKey === grant.policyKey && policy.policyVersion === grant.policyVersion && policy.fingerprint === grant.policyFingerprint && approvalFingerprint(safeContext) === grant.contextFingerprint ? policy : null;
    } catch {
      return null;
    }
  }

  private safeContextFromGrant(grant: EmergencyAccessGrantView) {
    return emergencySafeContext({
      grantId: grant.id,
      recipientEmployeeId: grant.recipientEmployeeId,
      reason: grant.reason,
      requestedRisk: grant.requestedRisk,
      effectiveRisk: grant.effectiveRisk,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      bindings: grant.bindings.map(({ permissionKey, riskClassification, scopeType, resourceType, resourceId }) => ({ permissionKey, riskClassification, scopeType, resourceType, resourceId })),
    });
  }

  private async denyActivation(actor: AuthorizationActor, grant: EmergencyAccessGrantView, denialCode: string, terminal: boolean, correlationId: string, at: Date, stepUp = false): Promise<never> {
    await this.repository.transaction((transaction) => this.repository.recordDenied({ organizationId: actor.organizationId, id: grant.id, actor, denialCode, correlationId, terminal, at }, transaction));
    this.metrics.record('activation_denied', grant.effectiveRisk);
    await this.notify('denied', grant.effectiveRisk, 'denied');
    if (stepUp) throw emergencyAccessStepUpRequired();
    throw emergencyAccessDenied();
  }

  private async withActions(actor: AuthorizationActor, grant: EmergencyAccessGrantView, at: Date): Promise<EmergencyAccessGrantView> {
    const resource: AuthorizationResource = { type: 'emergency-access-grant', organizationId: actor.organizationId, id: grant.id };
    const [activate, revoke] = await Promise.all([
      grant.requesterEmployeeId === actor.employeeId && grant.canActivate
        ? this.authorization.authorize(actor, 'admin.access.emergency', resource, { at, source: 'http', ...(grant.approvalReference ? { approvalReference: grant.approvalReference } : {}), approvalContext: this.safeContextFromGrant(grant) })
        : null,
      grant.canRevoke ? this.authorization.authorize(actor, 'admin.access.revoke', resource, { at, source: 'http' }) : null,
    ]);
    if (grant.status === 'ACTIVE') this.metrics.record('active', grant.effectiveRisk);
    if (grant.status === 'EXPIRED') this.metrics.record('expired', grant.effectiveRisk);
    return { ...grant, canActivate: Boolean(grant.canActivate && activate?.allowed), canRevoke: Boolean(grant.canRevoke && revoke?.allowed) };
  }

  private async notify(category: Parameters<EmergencyAccessAlertHook['notify']>[0]['category'], risk: EventRisk, outcome: 'succeeded' | 'denied'): Promise<void> {
    try {
      await this.alerts.notify({ category, risk, outcome });
    } catch {
      // Persisted audit/security/outbox evidence is authoritative; alert adapters are best-effort.
    }
  }
}
