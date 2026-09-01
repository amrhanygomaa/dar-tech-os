import { Writable } from 'node:stream';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore, StructuredLogger } from '@dar-tech/observability';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('does not expose or log an unknown provider error', () => {
    const logLines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    });
    const contextStore = new RequestContextStore();
    const logger = new StructuredLogger(contextStore, {
      runtime: 'api',
      environment: 'test',
      level: 'error',
      destination,
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const response = { status, json, setHeader: vi.fn() } as unknown as Response;
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as ArgumentsHost;
    const filter = new ApiExceptionFilter(contextStore, logger);

    contextStore.run(
      { requestId: 'request-safe', correlationId: 'correlation-safe', runtime: 'api' },
      () => {
        filter.catch(
          new Error('postgresql://operator:top-secret@database:5432/app'),
          host,
        );
      },
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: 'request-safe',
      },
    });
    expect(logLines.join('')).toContain('request-safe');
    expect(logLines.join('')).not.toContain('top-secret');
    expect(logLines.join('')).not.toContain('operator');
  });
});
