import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id' as const;
export const CORRELATION_ID_HEADER = 'x-correlation-id' as const;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function acceptedIdentifier(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return identifierPattern.test(value) ? value : undefined;
}

export interface RequestIdentifiers {
  readonly requestId: string;
  readonly correlationId: string;
}

export function createRequestIdentifiers(
  requestIdHeader: string | readonly string[] | undefined,
  correlationIdHeader: string | readonly string[] | undefined,
): RequestIdentifiers {
  const requestId = acceptedIdentifier(requestIdHeader) ?? randomUUID();
  return {
    requestId,
    correlationId: acceptedIdentifier(correlationIdHeader) ?? requestId,
  };
}

export function isValidCorrelationIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}
