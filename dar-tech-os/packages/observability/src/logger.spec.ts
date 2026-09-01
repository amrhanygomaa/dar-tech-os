import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DestinationStream } from 'pino';
import { RequestContextStore } from './request-context.js';
import { StructuredLogger } from './logger.js';

function capturingLogger(store: RequestContextStore): {
  logger: StructuredLogger;
  entries: Array<Record<string, unknown>>;
} {
  const entries: Array<Record<string, unknown>> = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      entries.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });

  return {
    logger: new StructuredLogger(store, {
      runtime: 'api',
      environment: 'test',
      level: 'trace',
      destination: destination as DestinationStream,
    }),
    entries,
  };
}

describe('StructuredLogger', () => {
  it('redacts sensitive fields and sensitive text patterns', () => {
    const { logger, entries } = capturingLogger(new RequestContextStore());

    logger.error(
      'Connection postgresql://operator:top-secret@database:5432/app failed token=secret-token',
      'stack containing Bearer secret-token',
      'DatabaseAdapter',
    );

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('stack containing');
    expect(entries[0]).toMatchObject({
      event: 'application.error',
      context: 'DatabaseAdapter',
    });
  });

  it('protects trusted correlation and event fields from caller overrides', () => {
    const store = new RequestContextStore();
    const { logger, entries } = capturingLogger(store);

    store.run(
      { requestId: 'trusted-request', correlationId: 'trusted-correlation', runtime: 'api' },
      () => {
        logger.info('foundation.event', {
          event: 'forged.event',
          requestId: 'forged-request',
          correlationId: 'forged-correlation',
          password: 'never-log-me',
        });
      },
    );

    expect(entries[0]).toMatchObject({
      event: 'foundation.event',
      requestId: 'trusted-request',
      correlationId: 'trusted-correlation',
      password: '[REDACTED]',
    });
  });
});
