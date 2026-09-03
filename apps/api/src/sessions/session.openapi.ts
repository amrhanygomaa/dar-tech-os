import type { SchemaObject } from '@nestjs/swagger';
import { errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

export { errorEnvelopeSchema, successEnvelope };

export const sessionSchema: SchemaObject = {
  type: 'object',
  required: [
    'id', 'current', 'clientKind', 'assuranceLevel', 'authenticatedAt', 'issuedAt',
    'lastSeenAt', 'idleExpiresAt', 'absoluteExpiresAt', 'revokedAt', 'status',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    current: { type: 'boolean' },
    clientKind: { type: 'string', enum: ['browser'] },
    assuranceLevel: { type: 'string', nullable: true },
    authenticatedAt: { type: 'string', format: 'date-time', nullable: true },
    issuedAt: { type: 'string', format: 'date-time' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    idleExpiresAt: { type: 'string', format: 'date-time' },
    absoluteExpiresAt: { type: 'string', format: 'date-time' },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
    status: {
      type: 'string',
      enum: ['ACTIVE', 'REVOKED', 'IDLE_EXPIRED', 'ABSOLUTE_EXPIRED', 'INACTIVE'],
    },
  },
};

export const revokeAllBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['includeCurrent'],
  properties: { includeCurrent: { type: 'boolean' } },
};

export const revokeResultSchema = successEnvelope({
  type: 'object',
  required: ['status', 'currentSessionRevoked'],
  properties: {
    status: { type: 'string', enum: ['revoked', 'idempotent'] },
    currentSessionRevoked: { type: 'boolean' },
  },
});

export const revokeAllResultSchema = successEnvelope({
  type: 'object',
  required: ['revokedCount', 'currentSessionRevoked'],
  properties: {
    revokedCount: { type: 'integer', minimum: 0 },
    currentSessionRevoked: { type: 'boolean' },
  },
});
