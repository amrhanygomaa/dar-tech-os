import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError, STRUCTURED_LOGGER, type StructuredLogger } from '@dar-tech/observability';
import { authenticationRequired, authorizationDenied } from '../identity/identity.errors.js';
import {
  ROLE_ACTIONS,
  ROLE_ACTOR_PORT,
  ROLE_AUTHORIZATION_PORT,
  ROLE_CLOCK,
  ROLE_METRICS_PORT,
  ROLE_REPOSITORY_PORT,
  type EmployeeRoleView,
  type RoleAction,
  type RoleActor,
  type RoleActorPort,
  type RoleAuthorizationPort,
  type RoleClock,
  type RoleMetricsPort,
  type RolePage,
  type RoleRepositoryPort,
  type RoleView,
} from './role.contracts.js';
import {
  invalidRoleInput,
  roleArchived,
  roleAssignmentConflict,
  roleConflict,
  roleResourceNotFound,
} from './role.errors.js';
import {
  parseAssignment,
  parseCreateRole,
  parseRoleId,
  parseRolePagination,
  parseUpdateRole,
} from './role-input.js';

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

type Operation = Parameters<RoleMetricsPort['record']>[0]['operation'];

@Injectable()
export class RoleService {
  constructor(
    @Inject(ROLE_ACTOR_PORT) private readonly actors: RoleActorPort,
    @Inject(ROLE_AUTHORIZATION_PORT) private readonly authorization: RoleAuthorizationPort,
    @Inject(ROLE_CLOCK) private readonly clock: RoleClock,
    @Inject(ROLE_REPOSITORY_PORT) private readonly repository: RoleRepositoryPort,
    @Inject(ROLE_METRICS_PORT) private readonly metrics: RoleMetricsPort,
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async list(pageInput?: string, pageSizeInput?: string): Promise<RolePage> {
    const actor = await this.requireActor('list');
    await this.requireAuthorization(actor, ROLE_ACTIONS.read, 'role', 'list');
    const { page, pageSize } = parseRolePagination(pageInput, pageSizeInput);
    const result = await this.repository.list(actor.organizationId, page, pageSize);
    this.metrics.record({ operation: 'list', outcome: 'succeeded' });
    return result;
  }

  async create(input: unknown): Promise<RoleView> {
    const actor = await this.requireActor('create');
    await this.requireAuthorization(actor, ROLE_ACTIONS.create, 'role', 'create');
    const role = parseCreateRole(input);
    try {
      const created = await this.repository.create({ actor, role, occurredAt: this.clock.now() });
      this.recordMutation('create', 'succeeded');
      return created;
    } catch (error) {
      this.recordFailure('create', error);
      if (hasErrorCode(error, 'P2002')) throw roleConflict();
      throw error;
    }
  }

  async update(roleIdInput: string, input: unknown): Promise<RoleView> {
    const actor = await this.requireActor('update');
    const roleId = parseRoleId(roleIdInput);
    await this.requireAuthorization(actor, ROLE_ACTIONS.update, 'role', 'update', roleId);
    const patch = parseUpdateRole(input);
    try {
      const result = await this.repository.update({
        actor,
        roleId,
        patch,
        occurredAt: this.clock.now(),
      });
      if (result.status === 'not_found') {
        this.metrics.record({ operation: 'update', outcome: 'not_found' });
        throw roleResourceNotFound();
      }
      this.recordMutation('update', result.status === 'idempotent' ? 'idempotent' : 'succeeded');
      return result.role;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      this.recordFailure('update', error);
      if (hasErrorCode(error, 'P2002')) throw roleConflict();
      throw error;
    }
  }

  async archive(roleIdInput: string): Promise<RoleView> {
    const actor = await this.requireActor('archive');
    const roleId = parseRoleId(roleIdInput);
    await this.requireAuthorization(actor, ROLE_ACTIONS.archive, 'role', 'archive', roleId);
    const result = await this.repository.archive({
      actor,
      roleId,
      occurredAt: this.clock.now(),
    });
    if (result.status === 'not_found') {
      this.metrics.record({ operation: 'archive', outcome: 'not_found' });
      throw roleResourceNotFound();
    }
    this.recordMutation('archive', result.status === 'idempotent' ? 'idempotent' : 'succeeded');
    return result.role;
  }

  async assign(employeeIdInput: string, input: unknown): Promise<EmployeeRoleView> {
    const actor = await this.requireActor('assign');
    const employeeId = parseRoleId(employeeIdInput);
    const assignment = parseAssignment(input);
    await this.requireAuthorization(
      actor,
      ROLE_ACTIONS.assign,
      'employee-role',
      'assign',
      employeeId,
    );
    const effectiveAt = this.clock.now();
    if (assignment.expiresAt && assignment.expiresAt.getTime() <= effectiveAt.getTime()) {
      this.metrics.record({ operation: 'assign', outcome: 'failed' });
      throw invalidRoleInput();
    }
    const result = await this.repository.assign({
      actor,
      employeeId,
      roleId: assignment.roleId,
      effectiveAt,
      expiresAt: assignment.expiresAt,
    });
    if (result.status === 'not_found') {
      this.metrics.record({ operation: 'assign', outcome: 'not_found' });
      throw roleResourceNotFound();
    }
    if (result.status === 'archived') {
      this.metrics.record({ operation: 'assign', outcome: 'conflict' });
      throw roleArchived();
    }
    if (result.status === 'conflict') {
      this.metrics.record({ operation: 'assign', outcome: 'conflict' });
      throw roleAssignmentConflict();
    }
    this.recordMutation('assign', result.status === 'idempotent' ? 'idempotent' : 'succeeded');
    return result.assignment;
  }

  async remove(employeeIdInput: string, roleIdInput: string): Promise<EmployeeRoleView> {
    const actor = await this.requireActor('remove');
    const employeeId = parseRoleId(employeeIdInput);
    const roleId = parseRoleId(roleIdInput);
    await this.requireAuthorization(
      actor,
      ROLE_ACTIONS.assign,
      'employee-role',
      'remove',
      employeeId,
    );
    const result = await this.repository.remove({
      actor,
      employeeId,
      roleId,
      removedAt: this.clock.now(),
    });
    if (result.status === 'not_found') {
      this.metrics.record({ operation: 'remove', outcome: 'not_found' });
      throw roleResourceNotFound();
    }
    this.recordMutation('remove', result.status === 'idempotent' ? 'idempotent' : 'succeeded');
    return result.assignment;
  }

  private async requireActor(operation: Operation): Promise<RoleActor> {
    const actor = await this.actors.currentActor();
    if (!actor) {
      this.metrics.record({
        operation,
        outcome: 'denied',
        denialCategory: 'missing_actor',
      });
      throw authenticationRequired();
    }
    return actor;
  }

  private async requireAuthorization(
    actor: RoleActor,
    action: RoleAction,
    type: 'role' | 'employee-role',
    operation: Operation,
    id?: string,
  ): Promise<void> {
    const allowed = await this.authorization.authorize({
      actor,
      action,
      resource: {
        type,
        organizationId: actor.organizationId,
        ...(id ? { id } : {}),
      },
    });
    if (!allowed) {
      this.metrics.record({
        operation,
        outcome: 'denied',
        denialCategory: 'authorization_denied',
      });
      throw authorizationDenied();
    }
  }

  private recordMutation(
    operation: Exclude<Operation, 'list'>,
    outcome: 'succeeded' | 'idempotent',
  ): void {
    this.metrics.record({ operation, outcome });
    this.logger.info('identity.role.command_completed', { operation, outcome });
  }

  private recordFailure(operation: Operation, error: unknown): void {
    this.metrics.record({ operation, outcome: 'failed' });
    this.logger.warnEvent('identity.role.command_failed', {
      operation,
      errorCategory: error instanceof Error ? error.name : 'unknown',
    });
  }
}
