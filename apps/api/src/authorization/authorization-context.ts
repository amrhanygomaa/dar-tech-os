import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuthorizationActor } from './authorization.contracts.js';

@Injectable()
export class AuthorizationActorContext {
  private readonly storage = new AsyncLocalStorage<AuthorizationActor | null>();

  run<T>(actor: AuthorizationActor | null, callback: () => T): T {
    return this.storage.run(actor, callback);
  }

  currentActor(): AuthorizationActor | null {
    return this.storage.getStore() ?? null;
  }
}
