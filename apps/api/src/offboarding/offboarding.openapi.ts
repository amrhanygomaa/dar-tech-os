import type { SchemaObject } from '@nestjs/swagger';
import { employeeDetailSchema, errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

export const lifecycleReasonSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    approvalReference: { type: 'string', format: 'uuid' },
  },
};

export const archiveCommandSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 0,
};

export const lifecycleCommandResponseSchema = successEnvelope({
  type: 'object',
  required: ['outcome', 'employee', 'approvalReference', 'securityBarrierActive', 'historyPreserved'],
  properties: {
    outcome: {
      type: 'string',
      enum: ['changed', 'idempotent', 'approval_required', 'cleanup_incomplete', 'cleanup_completed'],
    },
    employee: employeeDetailSchema,
    approvalReference: { type: 'string', format: 'uuid', nullable: true },
    securityBarrierActive: { type: 'boolean' },
    historyPreserved: { type: 'boolean', enum: [true] },
  },
});

export { errorEnvelopeSchema };
