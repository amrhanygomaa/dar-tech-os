import { Injectable } from '@nestjs/common';
import type {
  InvitationActor,
  InvitationActorPort,
  InvitationAuthorizationPort,
} from './invitation.contracts.js';

@Injectable()
export class DenyAllInvitationActorAdapter implements InvitationActorPort {
  currentActor(): Promise<InvitationActor | null> {
    return Promise.resolve(null);
  }
}
@Injectable()
export class DenyAllInvitationAuthorizationAdapter implements InvitationAuthorizationPort {
  authorize(_request: Parameters<InvitationAuthorizationPort['authorize']>[0]): Promise<boolean> {
    return Promise.resolve(false);
  }
}
