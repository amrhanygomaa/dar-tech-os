import { Inject, Injectable } from '@nestjs/common';
import {
  ApplicationError,
  STRUCTURED_LOGGER,
  type StructuredLogger,
} from '@dar-tech/observability';
import {
  AUTHENTICATED_ACTOR_PORT,
  IDENTITY_ACTIONS,
  IDENTITY_AUDIT_HOOK,
  IDENTITY_AUTHORIZATION_PORT,
  IDENTITY_REPOSITORY_PORT,
  IDENTITY_TRANSACTION_PORT,
  type AuthenticatedActorPort,
  type EmployeeDetailView,
  type EmployeePage,
  type IdentityAction,
  type IdentityAuditEntry,
  type IdentityAuditHook,
  type IdentityAuthorizationPort,
  type IdentityRepositoryPort,
  type IdentityTransactionPort,
  type SelfIdentityView,
  type TrustedActor,
} from './identity.contracts.js';
import { parseEmployeeProfilePatch } from './employee-profile.js';
import {
  authenticationRequired,
  authorizationDenied,
  identityResourceNotFound,
} from './identity.errors.js';

@Injectable()
export class IdentityService {
  constructor(
    @Inject(AUTHENTICATED_ACTOR_PORT)
    private readonly actors: AuthenticatedActorPort,
    @Inject(IDENTITY_AUTHORIZATION_PORT)
    private readonly authorization: IdentityAuthorizationPort,
    @Inject(IDENTITY_REPOSITORY_PORT)
    private readonly repository: IdentityRepositoryPort,
    @Inject(IDENTITY_AUDIT_HOOK)
    private readonly audit: IdentityAuditHook,
    @Inject(IDENTITY_TRANSACTION_PORT)
    private readonly transactions: IdentityTransactionPort,
    @Inject(STRUCTURED_LOGGER)
    private readonly logger: StructuredLogger,
  ) {}

  async getMe(): Promise<SelfIdentityView> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, IDENTITY_ACTIONS.readSelf, 'user-account');
    const view = await this.repository.findSelf(
      actor.organizationId,
      actor.employeeId,
      actor.userAccountId,
    );
    if (!view) {
      const error = authenticationRequired();
      this.logFailure(actor, IDENTITY_ACTIONS.readSelf, actor.userAccountId, error, 'user-account');
      throw error;
    }
    return view;
  }

  async updateMe(input: unknown): Promise<SelfIdentityView> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, IDENTITY_ACTIONS.updateSelf, 'user-account');
    const patch = this.parsePatch(
      actor,
      IDENTITY_ACTIONS.updateSelf,
      actor.employeeId,
      input,
      'self',
    );
    const employee = await this.mutateProfile(
      actor,
      IDENTITY_ACTIONS.updateSelf,
      actor.employeeId,
      patch,
      'authentication',
    );
    this.logMutation(actor, IDENTITY_ACTIONS.updateSelf, employee.id, Object.keys(patch));
    const view = await this.repository.findSelf(
      actor.organizationId,
      actor.employeeId,
      actor.userAccountId,
    );
    if (!view) {
      const error = authenticationRequired();
      this.logFailure(
        actor,
        IDENTITY_ACTIONS.updateSelf,
        actor.userAccountId,
        error,
        'user-account',
      );
      throw error;
    }
    return view;
  }

  async listEmployees(page: number, pageSize: number): Promise<EmployeePage> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, IDENTITY_ACTIONS.readEmployee, 'employee');
    return this.repository.listEmployees(actor.organizationId, page, pageSize);
  }

  async getEmployee(employeeId: string): Promise<EmployeeDetailView> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, IDENTITY_ACTIONS.readEmployee, 'employee', employeeId);
    const employee = await this.repository.findEmployeeById(actor.organizationId, employeeId);
    if (!employee) {
      const error = identityResourceNotFound();
      this.logFailure(actor, IDENTITY_ACTIONS.readEmployee, employeeId, error);
      throw error;
    }
    return employee;
  }

  async updateEmployee(employeeId: string, input: unknown): Promise<EmployeeDetailView> {
    const actor = await this.requireActor();
    await this.requireAuthorization(actor, IDENTITY_ACTIONS.updateEmployee, 'employee', employeeId);
    const patch = this.parsePatch(
      actor,
      IDENTITY_ACTIONS.updateEmployee,
      employeeId,
      input,
      'admin',
    );
    const employee = await this.mutateProfile(
      actor,
      IDENTITY_ACTIONS.updateEmployee,
      employeeId,
      patch,
      'not-found',
    );
    this.logMutation(actor, IDENTITY_ACTIONS.updateEmployee, employee.id, Object.keys(patch));
    return employee;
  }

  private async requireActor(): Promise<TrustedActor> {
    const actor = await this.actors.currentActor();
    if (!actor) {
      const error = authenticationRequired();
      this.logger.warnEvent('identity.authentication.failed', {
        outcome: 'denied',
        code: error.code,
      });
      throw error;
    }
    return actor;
  }

  private async requireAuthorization(
    actor: TrustedActor,
    action: IdentityAction,
    type: 'employee' | 'user-account',
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
      const error = authorizationDenied();
      this.logFailure(actor, action, id, error, type);
      throw error;
    }
  }

  private async mutateProfile(
    actor: TrustedActor,
    action: IdentityAuditEntry['action'],
    targetId: string,
    patch: Parameters<IdentityRepositoryPort['updateEmployeeProfile']>[2],
    missingTarget: 'authentication' | 'not-found',
  ): Promise<EmployeeDetailView> {
    return this.transactions.run(async (transaction) => {
      const actorEmployee = await this.repository.findEmployeeById(
        actor.organizationId,
        actor.employeeId,
        transaction,
      );
      const targetEmployee =
        actor.employeeId === targetId
          ? actorEmployee
          : await this.repository.findEmployeeById(actor.organizationId, targetId, transaction);
      if (!actorEmployee || !targetEmployee) {
        const error =
          missingTarget === 'authentication'
            ? authenticationRequired()
            : identityResourceNotFound();
        this.logFailure(actor, action, targetId, error);
        throw error;
      }
      await this.audit.record(
        {
          action,
          actor,
          targetType: 'employee',
          targetId,
          organizationId: actor.organizationId,
          changedFields: Object.keys(patch).sort(),
          actorSnapshot: {
            displayName: actorEmployee.displayName,
            employeeCode: actorEmployee.employeeCode,
          },
          targetSnapshot: {
            displayName: targetEmployee.displayName,
            employeeCode: targetEmployee.employeeCode,
          },
        },
        transaction,
      );
      const employee = await this.repository.updateEmployeeProfile(
        actor.organizationId,
        targetId,
        patch,
        transaction,
      );
      if (!employee) {
        const error =
          missingTarget === 'authentication'
            ? authenticationRequired()
            : identityResourceNotFound();
        this.logFailure(actor, action, targetId, error);
        throw error;
      }
      return employee;
    });
  }

  private logMutation(
    actor: TrustedActor,
    action: IdentityAction,
    targetId: string,
    changedFields: readonly string[],
  ): void {
    this.logger.info('identity.employee.profile_updated', {
      outcome: 'succeeded',
      action,
      organizationId: actor.organizationId,
      targetId,
      changedFields: [...changedFields].sort(),
    });
  }

  private parsePatch(
    actor: TrustedActor,
    action: IdentityAction,
    targetId: string,
    input: unknown,
    scope: 'self' | 'admin',
  ) {
    try {
      return parseEmployeeProfilePatch(input, scope);
    } catch (error) {
      this.logFailure(actor, action, targetId, error);
      throw error;
    }
  }

  private logFailure(
    actor: TrustedActor,
    action: IdentityAction,
    targetId: string | undefined,
    error: unknown,
    targetType: 'employee' | 'user-account' = 'employee',
  ): void {
    this.logger.warnEvent('identity.command.failed', {
      outcome: 'failed',
      action,
      organizationId: actor.organizationId,
      targetType,
      ...(targetId ? { targetId } : {}),
      code: error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR',
    });
  }
}
