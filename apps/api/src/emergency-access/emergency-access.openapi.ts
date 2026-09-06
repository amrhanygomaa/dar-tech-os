import type { SchemaObject } from '@nestjs/swagger';
import { errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

const risk = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] } satisfies SchemaObject;
const bindingSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['permissionKey', 'scopeType', 'resourceType'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    permissionKey: { type: 'string', maxLength: 160 },
    riskClassification: risk,
    scopeType: { type: 'string', enum: ['ASSIGNED', 'TEAM', 'DEPARTMENT', 'PROJECT', 'CUSTOMER', 'ORGANIZATION', 'EXPLICIT'] },
    resourceType: { type: 'string', maxLength: 80 },
    resourceId: { type: 'string', maxLength: 128, nullable: true },
  },
};

export const emergencyAccessRequestSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['recipientEmployeeId', 'reason', 'risk', 'startsAt', 'expiresAt', 'bindings'],
  properties: {
    recipientEmployeeId: { type: 'string', format: 'uuid' },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    risk,
    startsAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    bindings: { type: 'array', minItems: 1, maxItems: 50, items: bindingSchema },
  },
};

export const emergencyAccessSchema: SchemaObject = {
  type: 'object',
  required: [
    'id', 'organizationId', 'requesterEmployeeId', 'recipientEmployeeId', 'requesterSnapshot',
    'recipientSnapshot', 'reason', 'requestedRisk', 'effectiveRisk', 'startsAt', 'expiresAt',
    'activatedAt', 'storedStatus', 'status', 'approvalReference', 'approvalStatus',
    'approvalExecutionState', 'policyKey', 'policyVersion', 'stepUpAssuranceLevel',
    'stepUpVerifiedAt', 'denialCode', 'deniedAt', 'revokedAt', 'revokedByEmployeeId',
    'bindings', 'history', 'canActivate', 'canRevoke', 'createdAt', 'updatedAt', 'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    requesterEmployeeId: { type: 'string', format: 'uuid' },
    recipientEmployeeId: { type: 'string', format: 'uuid' },
    requesterSnapshot: { type: 'object', additionalProperties: { type: 'string' } },
    recipientSnapshot: { type: 'object', additionalProperties: { type: 'string' } },
    reason: { type: 'string', maxLength: 500 },
    requestedRisk: risk,
    effectiveRisk: risk,
    startsAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    activatedAt: { type: 'string', format: 'date-time', nullable: true },
    storedStatus: { type: 'string', enum: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'] },
    status: { type: 'string', enum: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'] },
    approvalReference: { type: 'string', format: 'uuid', nullable: true },
    approvalStatus: { type: 'string', nullable: true },
    approvalExecutionState: { type: 'string', nullable: true },
    policyKey: { type: 'string', maxLength: 160 },
    policyVersion: { type: 'integer', minimum: 1 },
    policyFingerprint: { type: 'string', writeOnly: true },
    contextFingerprint: { type: 'string', writeOnly: true },
    stepUpAssuranceLevel: { type: 'string', maxLength: 80 },
    stepUpVerifiedAt: { type: 'string', format: 'date-time' },
    denialCode: { type: 'string', nullable: true },
    deniedAt: { type: 'string', format: 'date-time', nullable: true },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
    revokedByEmployeeId: { type: 'string', format: 'uuid', nullable: true },
    bindings: { type: 'array', items: bindingSchema },
    history: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['eventType', 'outcome', 'risk', 'action', 'resourceType', 'resourceId', 'occurredAt'],
        properties: {
          eventType: { type: 'string', maxLength: 160 },
          outcome: { type: 'string', maxLength: 64 },
          risk,
          action: { type: 'string', nullable: true },
          resourceType: { type: 'string', nullable: true },
          resourceId: { type: 'string', nullable: true },
          occurredAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    canActivate: { type: 'boolean' },
    canRevoke: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
};

export const emergencyAccessResponseSchema = successEnvelope(emergencyAccessSchema);
export const emergencyAccessPageSchema = successEnvelope({
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: emergencyAccessSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
});
export const emergencyAccessActionSchema = successEnvelope({
  type: 'object',
  required: ['outcome', 'grant'],
  properties: {
    outcome: { type: 'string', enum: ['activated', 'revoked', 'idempotent'] },
    grant: emergencyAccessSchema,
  },
});
export { errorEnvelopeSchema };
