import { Inject, Injectable } from "@nestjs/common";
import {
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from "@dar-tech/observability";
import {
  authenticationRequired,
  authorizationDenied,
} from "../identity/identity.errors.js";
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTOR_PORT,
  PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT,
  PERMISSION_CLOCK,
  PERMISSION_METRICS_PORT,
  PERMISSION_REPOSITORY_PORT,
  type PermissionAction,
  type PermissionActor,
  type PermissionActorPort,
  type PermissionAdministrationAuthorizationPort,
  type PermissionClock,
  type PermissionMetricsPort,
  type PermissionPage,
  type PermissionRegistrySyncResult,
  type PermissionRegistryValidationResult,
  type PermissionRepositoryPort,
  type RolePermissionPage,
  type RolePermissionView,
} from "./permission.contracts.js";
import {
  invalidPermissionInput,
  permissionNotRegistered,
  permissionResourceNotFound,
  permissionRoleArchived,
  permissionUnavailable,
  rolePermissionConflict,
} from "./permission.errors.js";
import {
  parseGrantRolePermission,
  parsePermissionKeyInput,
  parsePermissionPagination,
  parsePermissionRoleId,
} from "./permission-input.js";
import {
  PERMISSION_REGISTRY,
  canonicalPermissionDefinition,
} from "./permission-manifest.js";

type Operation = Parameters<PermissionMetricsPort["record"]>[0]["operation"];

@Injectable()
export class PermissionService {
  constructor(
    @Inject(PERMISSION_ACTOR_PORT) private readonly actors: PermissionActorPort,
    @Inject(PERMISSION_ADMINISTRATION_AUTHORIZATION_PORT)
    private readonly authorization: PermissionAdministrationAuthorizationPort,
    @Inject(PERMISSION_CLOCK) private readonly clock: PermissionClock,
    @Inject(PERMISSION_REPOSITORY_PORT)
    private readonly repository: PermissionRepositoryPort,
    @Inject(PERMISSION_METRICS_PORT)
    private readonly metrics: PermissionMetricsPort,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async list(
    pageInput?: string,
    pageSizeInput?: string,
  ): Promise<PermissionPage> {
    const actor = await this.requireActor("catalog");
    await this.requireAuthorization(
      actor,
      PERMISSION_ACTIONS.read,
      "permission-catalog",
      "catalog",
    );
    const { page, pageSize } = parsePermissionPagination(
      pageInput,
      pageSizeInput,
    );
    const result = await this.repository.list(page, pageSize);
    this.metrics.record({ operation: "catalog", outcome: "succeeded" });
    return result;
  }

  async listRolePermissions(
    roleIdInput: string,
    pageInput?: string,
    pageSizeInput?: string,
  ): Promise<RolePermissionPage> {
    const actor = await this.requireActor("history");
    const roleId = parsePermissionRoleId(roleIdInput);
    await this.requireAuthorization(
      actor,
      PERMISSION_ACTIONS.read,
      "role-permission",
      "history",
      roleId,
    );
    const { page, pageSize } = parsePermissionPagination(
      pageInput,
      pageSizeInput,
    );
    const result = await this.repository.listRolePermissions(
      actor.organizationId,
      roleId,
      page,
      pageSize,
      this.clock.now(),
    );
    if (!result) {
      this.metrics.record({ operation: "history", outcome: "not_found" });
      throw permissionResourceNotFound();
    }
    this.metrics.record({ operation: "history", outcome: "succeeded" });
    return result;
  }

  async grant(
    roleIdInput: string,
    rawInput: unknown,
  ): Promise<RolePermissionView> {
    const actor = await this.requireActor("grant");
    const roleId = parsePermissionRoleId(roleIdInput);
    await this.requireAuthorization(
      actor,
      PERMISSION_ACTIONS.manage,
      "role-permission",
      "grant",
      roleId,
    );
    const grant = parseGrantRolePermission(rawInput);
    const definition = canonicalPermissionDefinition(grant.permissionKey);
    if (!definition) {
      this.metrics.record({ operation: "grant", outcome: "denied" });
      throw permissionNotRegistered();
    }
    const effectiveAt = this.clock.now();
    if (grant.expiresAt && grant.expiresAt.getTime() <= effectiveAt.getTime()) {
      this.metrics.record({ operation: "grant", outcome: "failed" });
      throw invalidPermissionInput();
    }
    const result = await this.repository.grant({
      actor,
      roleId,
      definition,
      grant,
      effectiveAt,
    });
    if (result.status === "not_found") {
      this.metrics.record({ operation: "grant", outcome: "not_found" });
      throw permissionResourceNotFound();
    }
    if (result.status === "archived") {
      this.metrics.record({ operation: "grant", outcome: "conflict" });
      throw permissionRoleArchived();
    }
    if (result.status === "permission_unavailable") {
      this.metrics.record({ operation: "grant", outcome: "denied" });
      throw permissionUnavailable();
    }
    if (result.status === "conflict") {
      this.metrics.record({ operation: "grant", outcome: "conflict" });
      throw rolePermissionConflict();
    }
    const outcome = result.status === "idempotent" ? "idempotent" : "succeeded";
    this.metrics.record({
      operation: "grant",
      outcome,
      risk: definition.riskClassification,
      scopeType: grant.scopeType,
    });
    this.logger.info("identity.permission.command_completed", {
      operation: "grant",
      outcome,
      risk: definition.riskClassification,
      scopeType: grant.scopeType,
    });
    return result.grant;
  }

  async remove(
    roleIdInput: string,
    permissionKeyInput: string,
  ): Promise<RolePermissionView> {
    const actor = await this.requireActor("remove");
    const roleId = parsePermissionRoleId(roleIdInput);
    const permissionKey = parsePermissionKeyInput(permissionKeyInput);
    await this.requireAuthorization(
      actor,
      PERMISSION_ACTIONS.manage,
      "role-permission",
      "remove",
      roleId,
      permissionKey,
    );
    const definition = canonicalPermissionDefinition(permissionKey);
    if (!definition) {
      this.metrics.record({ operation: "remove", outcome: "denied" });
      throw permissionNotRegistered();
    }
    const result = await this.repository.remove({
      actor,
      roleId,
      definition,
      removedAt: this.clock.now(),
    });
    if (result.status === "not_found") {
      this.metrics.record({ operation: "remove", outcome: "not_found" });
      throw permissionResourceNotFound();
    }
    const outcome = result.status === "idempotent" ? "idempotent" : "succeeded";
    this.metrics.record({
      operation: "remove",
      outcome,
      risk: definition.riskClassification,
      scopeType: result.grant.scopeType,
    });
    this.logger.info("identity.permission.command_completed", {
      operation: "remove",
      outcome,
      risk: definition.riskClassification,
      scopeType: result.grant.scopeType,
    });
    return result.grant;
  }

  private async requireActor(operation: Operation): Promise<PermissionActor> {
    const actor = await this.actors.currentActor();
    if (!actor) {
      this.metrics.record({
        operation,
        outcome: "denied",
        denialCategory: "missing_actor",
      });
      throw authenticationRequired();
    }
    return actor;
  }

  private async requireAuthorization(
    actor: PermissionActor,
    action: PermissionAction,
    type: "permission-catalog" | "role-permission",
    operation: Operation,
    roleId?: string,
    permissionKey?: string,
  ): Promise<void> {
    const allowed = await this.authorization.allows({
      actor,
      action,
      resource: {
        type,
        organizationId: actor.organizationId,
        ...(roleId ? { roleId } : {}),
        ...(permissionKey ? { permissionKey } : {}),
      },
    });
    if (!allowed) {
      this.metrics.record({
        operation,
        outcome: "denied",
        denialCategory: "authorization_denied",
      });
      throw authorizationDenied();
    }
  }
}

@Injectable()
export class PermissionRegistryService {
  constructor(
    @Inject(PERMISSION_CLOCK) private readonly clock: PermissionClock,
    @Inject(PERMISSION_REPOSITORY_PORT)
    private readonly repository: PermissionRepositoryPort,
    @Inject(PERMISSION_METRICS_PORT)
    private readonly metrics: PermissionMetricsPort,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async synchronize(): Promise<PermissionRegistrySyncResult> {
    try {
      const result = await this.repository.synchronizeRegistry(
        PERMISSION_REGISTRY,
        this.clock.now(),
      );
      this.metrics.record({ operation: "sync", outcome: "succeeded" });
      this.logger.info("identity.permission.registry_sync_completed", {
        ...result,
      });
      return result;
    } catch (error) {
      this.metrics.record({ operation: "sync", outcome: "failed" });
      this.logger.errorEvent("identity.permission.registry_sync_failed", {
        errorCategory: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }

  async validate(): Promise<PermissionRegistryValidationResult> {
    const result = await this.repository.validateRegistry(PERMISSION_REGISTRY);
    this.metrics.record({
      operation: "validate",
      outcome: result.valid ? "succeeded" : "drift",
    });
    this.logger.info("identity.permission.registry_validation_completed", {
      outcome: result.valid ? "valid" : "drift",
      issueCount: result.issues.length,
    });
    return result;
  }
}
