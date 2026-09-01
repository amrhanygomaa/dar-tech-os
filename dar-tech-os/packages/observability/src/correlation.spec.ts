import { describe, expect, it } from 'vitest';
import { createRequestIdentifiers, isValidCorrelationIdentifier } from './correlation.js';

describe('request identifiers', () => {
  it('accepts valid caller identifiers', () => {
    expect(createRequestIdentifiers('request-123', 'correlation:456')).toEqual({
      requestId: 'request-123',
      correlationId: 'correlation:456',
    });
  });

  it('creates a correlation ID from a generated request ID', () => {
    const identifiers = createRequestIdentifiers(undefined, undefined);

    expect(isValidCorrelationIdentifier(identifiers.requestId)).toBe(true);
    expect(identifiers.correlationId).toBe(identifiers.requestId);
  });

  it('rejects identifiers that could inject log content', () => {
    const identifiers = createRequestIdentifiers('bad\nvalue', ['also-bad']);

    expect(identifiers.requestId).not.toBe('bad\nvalue');
    expect(identifiers.correlationId).toBe(identifiers.requestId);
  });
});
