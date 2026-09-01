import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_CLIENT, type DatabaseClient } from '@dar-tech/database';
import type {
  AuthenticationIdentityRepositoryPort,
  LinkedAuthenticationIdentity,
} from './auth.contracts.js';

@Injectable()
export class PrismaAuthenticationIdentityRepository
  implements AuthenticationIdentityRepositoryPort
{
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  async findLinkedIdentity(
    providerKey: string,
    providerSubject: string,
  ): Promise<LinkedAuthenticationIdentity | null> {
    const identity = await this.client.sSOIdentity.findUnique({
      where: {
        providerKey_providerSubject: {
          providerKey: providerKey.trim().toLowerCase(),
          providerSubject: providerSubject.trim(),
        },
      },
      select: {
        id: true,
        organizationId: true,
        userAccount: {
          select: {
            id: true,
            organizationId: true,
            employeeId: true,
            authenticationEligible: true,
            disabledAt: true,
            employee: {
              select: {
                id: true,
                organizationId: true,
                lifecycleStatus: true,
              },
            },
          },
        },
      },
    });
    if (!identity) return null;
    return {
      ssoIdentityId: identity.id,
      organizationId: identity.organizationId,
      userAccount: {
        id: identity.userAccount.id,
        organizationId: identity.userAccount.organizationId,
        employeeId: identity.userAccount.employeeId,
        authenticationEligible: identity.userAccount.authenticationEligible,
        disabledAt: identity.userAccount.disabledAt,
      },
      employee: identity.userAccount.employee,
    };
  }
}
