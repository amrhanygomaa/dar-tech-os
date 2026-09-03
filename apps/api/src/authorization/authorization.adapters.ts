import { Inject, Injectable } from '@nestjs/common';
import type { EventHistoryActorPort, EventHistoryAuthorizationPort } from '../event-history/event-history.contracts.js';
import type { AuthenticatedActorPort, IdentityAuthorizationPort } from '../identity/identity.contracts.js';
import type { InvitationActorPort, InvitationAuthorizationPort } from '../invitations/invitation.contracts.js';
import type { PermissionActorPort, PermissionAdministrationAuthorizationPort } from '../permissions/permission.contracts.js';
import type { RoleActorPort, RoleAuthorizationPort } from '../roles/role.contracts.js';
import type { SessionAuthorizationPort } from '../sessions/session.contracts.js';
import { AuthorizationActorContext } from './authorization-context.js';
import { AUTHORIZATION_CLOCK, type AuthorizationClock, type AuthorizationResource } from './authorization.contracts.js';
import { AuthorizationService } from './authorization.service.js';

@Injectable()
export class CentralAuthenticatedActorAdapter
  implements AuthenticatedActorPort, InvitationActorPort, RoleActorPort, PermissionActorPort, EventHistoryActorPort
{
  constructor(@Inject(AuthorizationActorContext) private readonly context: AuthorizationActorContext) {}

  currentActor() {
    const actor = this.context.currentActor();
    return Promise.resolve(
      actor
        ? {
            actorType: 'employee' as const,
            organizationId: actor.organizationId,
            employeeId: actor.employeeId,
            userAccountId: actor.userAccountId,
          }
        : null,
    );
  }
}

abstract class CentralAuthorizationAdapterBase {
  constructor(
    protected readonly context: AuthorizationActorContext,
    protected readonly authorization: AuthorizationService,
    protected readonly clock: AuthorizationClock,
  ) {}

  protected async decide(
    suppliedActor: { readonly organizationId: string; readonly employeeId: string; readonly userAccountId: string },
    action: string,
    resource: AuthorizationResource,
  ): Promise<boolean> {
    const actor = this.context.currentActor();
    if (
      !actor ||
      actor.organizationId !== suppliedActor.organizationId ||
      actor.employeeId !== suppliedActor.employeeId ||
      actor.userAccountId !== suppliedActor.userAccountId
    ) {
      return false;
    }
    return (
      await this.authorization.authorize(actor, action, resource, {
        at: this.clock.now(),
        source: 'http',
      })
    ).allowed;
  }
}

@Injectable()
export class CentralIdentityAuthorizationAdapter
  extends CentralAuthorizationAdapterBase
  implements IdentityAuthorizationPort
{
  constructor(
    @Inject(AuthorizationActorContext) context: AuthorizationActorContext,
    @Inject(AuthorizationService) authorization: AuthorizationService,
    @Inject(AUTHORIZATION_CLOCK) clock: AuthorizationClock,
  ) { super(context, authorization, clock); }

  authorize(request: Parameters<IdentityAuthorizationPort['authorize']>[0]): Promise<boolean> {
    const self = request.resource.type === 'user-account';
    return this.decide(request.actor, request.action, {
      type: request.resource.type,
      organizationId: request.resource.organizationId,
      ...(request.resource.id ? { id: request.resource.id } : {}),
      ...(self
        ? {
            ownerEmployeeId: request.actor.employeeId,
            ownerUserAccountId: request.actor.userAccountId,
          }
        : {}),
    });
  }
}

@Injectable()
export class CentralInvitationAuthorizationAdapter
  extends CentralAuthorizationAdapterBase
  implements InvitationAuthorizationPort
{
  constructor(@Inject(AuthorizationActorContext) context: AuthorizationActorContext, @Inject(AuthorizationService) authorization: AuthorizationService, @Inject(AUTHORIZATION_CLOCK) clock: AuthorizationClock) { super(context, authorization, clock); }
  authorize(request: Parameters<InvitationAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return this.decide(request.actor, request.action, {
      type: 'invitation',
      organizationId: request.resource.organizationId,
      ...(request.resource.id ? { id: request.resource.id } : {}),
    });
  }
}

@Injectable()
export class CentralRoleAuthorizationAdapter
  extends CentralAuthorizationAdapterBase
  implements RoleAuthorizationPort
{
  constructor(@Inject(AuthorizationActorContext) context: AuthorizationActorContext, @Inject(AuthorizationService) authorization: AuthorizationService, @Inject(AUTHORIZATION_CLOCK) clock: AuthorizationClock) { super(context, authorization, clock); }
  authorize(request: Parameters<RoleAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return this.decide(request.actor, request.action, {
      type: request.resource.type,
      organizationId: request.resource.organizationId,
      ...(request.resource.id ? { id: request.resource.id } : {}),
    });
  }
}

@Injectable()
export class CentralPermissionAuthorizationAdapter
  extends CentralAuthorizationAdapterBase
  implements PermissionAdministrationAuthorizationPort
{
  constructor(@Inject(AuthorizationActorContext) context: AuthorizationActorContext, @Inject(AuthorizationService) authorization: AuthorizationService, @Inject(AUTHORIZATION_CLOCK) clock: AuthorizationClock) { super(context, authorization, clock); }
  allows(request: Parameters<PermissionAdministrationAuthorizationPort['allows']>[0]): Promise<boolean> {
    return this.decide(request.actor, request.action, {
      type: request.resource.type === 'permission-catalog' ? 'permission-registry' : 'role-permissions',
      organizationId: request.resource.organizationId,
      ...(request.resource.roleId ? { id: request.resource.roleId } : {}),
    });
  }
}

@Injectable()
export class CentralEventHistoryAuthorizationAdapter
  extends CentralAuthorizationAdapterBase
  implements EventHistoryAuthorizationPort
{
  constructor(@Inject(AuthorizationActorContext) context: AuthorizationActorContext, @Inject(AuthorizationService) authorization: AuthorizationService, @Inject(AUTHORIZATION_CLOCK) clock: AuthorizationClock) { super(context, authorization, clock); }
  authorize(request: Parameters<EventHistoryAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return this.decide(request.actor, request.action, {
      type: request.resource.type,
      organizationId: request.resource.organizationId,
      ...(request.resource.id ? { id: request.resource.id } : {}),
    });
  }
}

@Injectable()
export class CentralSessionAuthorizationAdapter implements SessionAuthorizationPort {
  constructor(
    @Inject(AuthorizationActorContext) private readonly context: AuthorizationActorContext,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AUTHORIZATION_CLOCK) private readonly clock: AuthorizationClock,
  ) {}

  async allows(request: Parameters<SessionAuthorizationPort['allows']>[0]): Promise<boolean> {
    const requestActor = this.context.currentActor();
    if (
      !requestActor ||
      requestActor.sessionId !== request.actor.sessionId ||
      requestActor.organizationId !== request.actor.organizationId ||
      requestActor.employeeId !== request.actor.employeeId ||
      requestActor.userAccountId !== request.actor.userAccountId
    ) {
      return false;
    }
    const actor = { ...request.actor, actorType: 'employee' as const };
    return (
      await this.authorization.authorize(
        actor,
        request.action,
        {
          ...request.resource,
        },
        { at: this.clock.now(), source: 'http' },
      )
    ).allowed;
  }
}
