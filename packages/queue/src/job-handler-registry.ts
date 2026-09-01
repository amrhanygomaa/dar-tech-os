import type { JobHandler } from './contracts.js';

function handlerKey(name: string, version: number): string {
  return `${name}@v${version}`;
}

export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(handlers: readonly JobHandler[]) {
    for (const handler of handlers) {
      const key = handlerKey(handler.name, handler.version);
      if (this.handlers.has(key)) {
        throw new Error(`Duplicate queue job handler registration: ${key}`);
      }
      this.handlers.set(key, handler);
    }
  }

  resolve(name: string, version: number): JobHandler | undefined {
    return this.handlers.get(handlerKey(name, version));
  }
}
