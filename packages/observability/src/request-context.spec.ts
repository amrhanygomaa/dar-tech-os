import { describe, expect, it } from 'vitest';
import { RequestContextStore } from './request-context.js';

describe('RequestContextStore', () => {
  it('isolates concurrent asynchronous request contexts', async () => {
    const store = new RequestContextStore();

    const readAfter = (requestId: string, delayMs: number): Promise<string | undefined> =>
      store.run(
        { requestId, correlationId: requestId, runtime: 'api' },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return store.get()?.requestId;
        },
      );

    await expect(Promise.all([readAfter('first', 10), readAfter('second', 1)])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(store.get()).toBeUndefined();
  });
});
