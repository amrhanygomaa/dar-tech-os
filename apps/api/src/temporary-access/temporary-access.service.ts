import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  REQUEST_CONTEXT_STORE,
  type RequestContextStore,
} from "@dar-tech/observability";
import { ApprovalService } from "../approvals/approval.service.js";
import { AuthorizationActorContext } from "../authorization/authorization-context.js";
import {
  AUTHORIZATION_CLOCK,
  type AuthorizationActor,
  type AuthorizationClock,
  type AuthorizationResource,
} from "../authorization/authorization.contracts.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { canonicalPermissionDefinition } from "../permissions/permission-manifest.js";
import type { EventRisk } from "../event-history/event-history.contracts.js";
import {
  TEMPORARY_ACCESS_CONFIG,
  TEMPORARY_ACCESS_REPOSITORY,
  type TemporaryAccessBindingInput,
  type TemporaryAccessGrantView,
  type TemporaryAccessPage,
  type TemporaryAccessRepositoryPort,
  type TemporaryAccessRuntimeConfig,
} from "./temporary-access.contracts.js";
import {
  temporaryAccessAuthenticationRequired,
  temporaryAccessConflict,
  temporaryAccessDenied,
  temporaryAccessNotFound,
  temporaryAccessStepUpRequired,
} from "./temporary-access.errors.js";
import {
  parseTemporaryAccessCreate,
  parseTemporaryAccessId,
  parseTemporaryAccessList,
  sha256,
} from "./temporary-access-input.js";
import { TemporaryAccessMetrics } from "./temporary-access-metrics.js";

@Injectable()
export class TemporaryAccessService {
  constructor(
    @Inject(AuthorizationActorContext)
    private readonly actors: AuthorizationActorContext,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(AUTHORIZATION_CLOCK) private readonly clock: AuthorizationClock,
    @Inject(TEMPORARY_ACCESS_CONFIG)
    private readonly config: TemporaryAccessRuntimeConfig,
    @Inject(TEMPORARY_ACCESS_REPOSITORY)
    private readonly repository: TemporaryAccessRepositoryPort,
    @Inject(REQUEST_CONTEXT_STORE)
    private readonly context: RequestContextStore,
    @Inject(TemporaryAccessMetrics)
    private readonly metrics: TemporaryAccessMetrics,
  ) {}

  async create(
    recipientIdInput: string,
    body: unknown,
    idempotencyKey: unknown,
  ): Promise<TemporaryAccessGrantView> {
    const actor = this.requireActor();
    const recipientId = parseTemporaryAccessId(recipientIdInput);
    const at = this.clock.now();
    const parsed = parseTemporaryAccessCreate(
      body,
      idempotencyKey,
      at,
      this.config.maxDurationSeconds,
    );
    const recipient = await this.repository.findRecipient(
      actor.organizationId,
      recipientId,
    );
    const issuer = await this.repository.findRecipient(
      actor.organizationId,
      actor.employeeId,
    );
    if (!recipient) throw temporaryAccessNotFound();
    if (!recipient.active || !issuer?.active) throw temporaryAccessDenied();
    const bindings = parsed.bindings.map((binding) => {
      const definition = canonicalPermissionDefinition(binding.permissionKey);
      if (!definition) throw temporaryAccessDenied();
      return { ...binding, riskClassification: definition.riskClassification };
    });
    const bindingFingerprint = sha256(JSON.stringify(bindings));
    const reasonFingerprint = sha256(parsed.reason);
    const safeContext = {
      operation: "temporary_access_create",
      recipientId,
      bindingFingerprint,
      reasonFingerprint,
      startsAt: parsed.startsAt.toISOString(),
      expiresAt: parsed.expiresAt.toISOString(),
    } as const;
    const contextFingerprint = sha256(JSON.stringify(safeContext));
    const keyDigest = sha256(
      actor.organizationId,
      actor.employeeId,
      parsed.idempotencyKey,
    );
    const requestFingerprint = sha256(
      actor.organizationId,
      actor.employeeId,
      recipientId,
      parsed.reason,
      parsed.startsAt.toISOString(),
      parsed.expiresAt.toISOString(),
      JSON.stringify(bindings),
    );
    const resource: AuthorizationResource = {
      type: "employee",
      organizationId: actor.organizationId,
      id: recipientId,
    };
    await this.requireDelegation(actor, bindings, at);
    const correlationId = this.context.get()?.correlationId ?? randomUUID();

    try {
      return await this.repository.transaction(async (transaction) => {
        await this.repository.lockIdempotency(transaction, keyDigest);
        const existing = await this.repository.findByIdempotency(
          actor.organizationId,
          keyDigest,
          at,
          transaction,
        );
        if (existing) {
          const rawFingerprint = await this.existingFingerprint(
            existing.id,
            transaction,
          );
          if (rawFingerprint !== requestFingerprint)
            throw temporaryAccessConflict();
          if (existing.storedStatus !== "PENDING_APPROVAL")
            return this.withCanRevoke(actor, existing, at);
          if (
            !parsed.approvalReference ||
            existing.approvalReference !== parsed.approvalReference
          )
            return this.withCanRevoke(actor, existing, at);
          await this.requireActivationState(
            actor,
            recipientId,
            bindings,
            at,
            transaction,
          );
          return this.activateApproved(
            actor,
            existing.id,
            parsed.approvalReference,
            resource,
            safeContext,
            correlationId,
            at,
            transaction,
          );
        }

        const prepared = await this.approvals.prepareApprovalForAction(
          {
            actor,
            action: "admin.access.temporary",
            resource,
            risk: "HIGH",
            safeContext,
            requesterSnapshot: { displayName: issuer.displayName },
            resourceSnapshot: { displayName: recipient.displayName },
            safeReason: parsed.reason,
            correlationId,
            idempotencyMaterial: keyDigest,
            at,
          },
          transaction,
        );
        if (prepared.outcome === "STEP_UP_REQUIRED")
          throw temporaryAccessStepUpRequired();
        const requiresApproval = prepared.outcome === "APPROVAL_REQUIRED";
        const approvalReference = requiresApproval ? prepared.request.id : null;
        if (
          parsed.approvalReference &&
          parsed.approvalReference !== approvalReference
        )
          throw temporaryAccessDenied();
        const grant = await this.repository.create(
          {
            actor,
            recipient,
            reason: parsed.reason,
            startsAt: parsed.startsAt,
            expiresAt: parsed.expiresAt,
            bindings,
            idempotencyDigest: keyDigest,
            requestFingerprint,
            contextFingerprint,
            approvalReference,
            granted: !requiresApproval,
            correlationId,
            at,
          },
          transaction,
        );
        if (!requiresApproval) return this.withCanRevoke(actor, grant, at);
        if (
          parsed.approvalReference &&
          prepared.request.status === "APPROVED"
        ) {
          await this.requireActivationState(
            actor,
            recipientId,
            bindings,
            at,
            transaction,
          );
          return this.activateApproved(
            actor,
            grant.id,
            parsed.approvalReference,
            resource,
            safeContext,
            correlationId,
            at,
            transaction,
          );
        }
        return this.withCanRevoke(actor, grant, at);
      });
    } catch (error) {
      this.metrics.record("creation_failed");
      throw error;
    }
  }

  async list(
    page?: string,
    pageSize?: string,
    status?: string,
    recipientEmployeeId?: string,
  ): Promise<TemporaryAccessPage> {
    const actor = this.requireActor();
    const input = parseTemporaryAccessList(
      page,
      pageSize,
      status,
      recipientEmployeeId,
    );
    const at = this.clock.now();
    const decision = await this.authorization.authorize(
      actor,
      "admin.access.temporary",
      { type: "temporary-access-grant", organizationId: actor.organizationId },
      { at, source: "http" },
    );
    if (
      !decision.allowed ||
      decision.matchedGrant?.scopeType !== "ORGANIZATION"
    )
      throw temporaryAccessDenied();
    const result = await this.repository.list({
      organizationId: actor.organizationId,
      ...input,
      at,
    });
    return {
      ...result,
      items: await Promise.all(
        result.items.map((grant) => this.withCanRevoke(actor, grant, at)),
      ),
    };
  }

  async detail(idInput: string): Promise<TemporaryAccessGrantView> {
    const actor = this.requireActor();
    const id = parseTemporaryAccessId(idInput);
    const at = this.clock.now();
    await this.requireAuthorization(
      actor,
      "admin.access.temporary",
      {
        type: "temporary-access-grant",
        organizationId: actor.organizationId,
        id,
      },
      at,
    );
    const grant = await this.repository.findById(actor.organizationId, id, at);
    if (!grant) throw temporaryAccessNotFound();
    return this.withCanRevoke(actor, grant, at);
  }

  async revoke(
    idInput: string,
  ): Promise<{
    readonly outcome: "revoked" | "idempotent";
    readonly grant: TemporaryAccessGrantView;
  }> {
    const actor = this.requireActor();
    const id = parseTemporaryAccessId(idInput);
    const at = this.clock.now();
    const resource: AuthorizationResource = {
      type: "temporary-access-grant",
      organizationId: actor.organizationId,
      id,
    };
    await this.requireAuthorization(actor, "admin.access.revoke", resource, at);
    const correlationId = this.context.get()?.correlationId ?? randomUUID();
    const result = await this.repository.transaction((transaction) =>
      this.repository.revoke(
        {
          organizationId: actor.organizationId,
          id,
          actorEmployeeId: actor.employeeId,
          correlationId,
          at,
        },
        transaction,
      ),
    );
    if (!result.grant || result.outcome === "not_found")
      throw temporaryAccessNotFound();
    this.metrics.record(
      result.grant.status === "EXPIRED" ? "expired" : "revoked",
    );
    return {
      outcome: result.outcome,
      grant: await this.withCanRevoke(actor, result.grant, at),
    };
  }

  private requireActor(): AuthorizationActor {
    const actor = this.actors.currentActor();
    if (!actor) throw temporaryAccessAuthenticationRequired();
    return actor;
  }

  private async requireDelegation(
    actor: AuthorizationActor,
    bindings: readonly (TemporaryAccessBindingInput & {
      readonly riskClassification: EventRisk;
    })[],
    at: Date,
  ): Promise<void> {
    for (const binding of bindings) {
      const resource: AuthorizationResource = {
        type: binding.resourceType,
        organizationId: actor.organizationId,
        ...(binding.resourceId ? { id: binding.resourceId } : {}),
      };
      const decision = await this.authorization.authorize(
        actor,
        binding.permissionKey,
        resource,
        { at, source: "application" },
      );
      if (!decision.allowed || !decision.matchedGrant)
        throw temporaryAccessDenied();

      // A grant may only be delegated where its containment can be proven by
      // this exact authorization check.  An extension scope can have a wider,
      // resolver-defined reach, so only an organization grant can delegate it.
      const permitted =
        binding.scopeType === "ORGANIZATION"
          ? decision.matchedGrant.scopeType === "ORGANIZATION"
          : binding.scopeType === "EXPLICIT"
            ? decision.matchedGrant.scopeType === "ORGANIZATION" ||
              decision.matchedGrant.scopeType === "EXPLICIT"
            : decision.matchedGrant.scopeType === "ORGANIZATION";
      if (!permitted) throw temporaryAccessDenied();
    }
  }

  private async requireActivationState(
    actor: AuthorizationActor,
    recipientId: string,
    bindings: readonly (TemporaryAccessBindingInput & {
      readonly riskClassification: EventRisk;
    })[],
    at: Date,
    transaction: import("@dar-tech/database").DatabaseTransaction,
  ): Promise<void> {
    const recipient = await this.repository.findRecipient(
      actor.organizationId,
      recipientId,
      transaction,
    );
    if (!recipient?.active) throw temporaryAccessDenied();
    await this.requireDelegation(actor, bindings, at);
  }

  private async activateApproved(
    actor: AuthorizationActor,
    grantId: string,
    approvalReference: string,
    resource: AuthorizationResource,
    safeContext: Readonly<Record<string, string>>,
    correlationId: string,
    at: Date,
    transaction: import("@dar-tech/database").DatabaseTransaction,
  ): Promise<TemporaryAccessGrantView> {
    const claim = await this.approvals.claimApprovedAction(
      {
        actor,
        approvalReference,
        action: "admin.access.temporary",
        resource,
        risk: "HIGH",
        safeContext,
        correlationId,
        at,
      },
      transaction,
    );
    if (claim.status !== "claimed") {
      if (claim.status === "already_processing")
        throw temporaryAccessConflict();
      throw temporaryAccessDenied();
    }
    const grant = await this.repository.activate(
      {
        organizationId: actor.organizationId,
        grantId,
        actorEmployeeId: actor.employeeId,
        approvalReference,
        correlationId,
        at,
      },
      transaction,
    );
    await this.approvals.completeApprovedAction(
      {
        claimVersion: claim.claimVersion,
        organizationId: actor.organizationId,
        approvalReference,
        resultReference: `temporary-access-grant:${grant.id}`,
        correlationId,
        at,
      },
      transaction,
    );
    return this.withCanRevoke(actor, grant, at);
  }

  private async requireAuthorization(
    actor: AuthorizationActor,
    action: string,
    resource: AuthorizationResource,
    at: Date,
  ): Promise<void> {
    const decision = await this.authorization.authorize(
      actor,
      action,
      resource,
      { at, source: "http" },
    );
    if (!decision.allowed) throw temporaryAccessDenied();
  }

  private async withCanRevoke(
    actor: AuthorizationActor,
    grant: TemporaryAccessGrantView,
    at: Date,
  ): Promise<TemporaryAccessGrantView> {
    const eligible = grant.storedStatus === "GRANTED" && at < grant.expiresAt;
    const decision = eligible
      ? await this.authorization.authorize(
          actor,
          "admin.access.revoke",
          {
            type: "temporary-access-grant",
            organizationId: actor.organizationId,
            id: grant.id,
          },
          { at, source: "http" },
        )
      : null;
    if (grant.status === "ACTIVE") this.metrics.record("active");
    if (grant.status === "EXPIRED") this.metrics.record("expired");
    if (grant.status === "REVOKED") this.metrics.record("revoked");
    if (
      grant.status === "SCHEDULED" ||
      (grant.status === "ACTIVE" &&
        grant.expiresAt.getTime() - at.getTime() <= 3_600_000)
    )
      this.metrics.record("expiring");
    return { ...grant, canRevoke: Boolean(eligible && decision?.allowed) };
  }

  private async existingFingerprint(
    id: string,
    transaction: import("@dar-tech/database").DatabaseTransaction,
  ): Promise<string> {
    const row = await transaction.temporaryAccessGrant.findUnique({
      where: { id },
      select: { requestFingerprint: true },
    });
    if (!row) throw temporaryAccessConflict();
    return row.requestFingerprint;
  }
}
