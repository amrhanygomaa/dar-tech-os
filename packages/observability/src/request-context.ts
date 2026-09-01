import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeName } from '@dar-tech/types';

export interface RequestContext {
  readonly requestId?: string;
  readonly jobId?: string;
  readonly correlationId: string;
  readonly runtime: RuntimeName;
}

export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }
}
