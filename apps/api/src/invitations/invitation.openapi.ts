import type { SchemaObject } from '@nestjs/swagger';
import { authenticationCallbackBodySchema, authenticationStartResponseSchema } from '../auth/auth.openapi.js';
import { errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

export { errorEnvelopeSchema, successEnvelope };

const nullableDateTime: SchemaObject = {
  type: 'string',
  format: 'date-time',
  nullable: true,
};

export const invitationSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'employeeId',
    'userAccountId',
    'invitedEmailNormalized',
    'status',
    'issuerEmployeeId',
    'issuedAt',
    'expiresAt',
    'acceptedAt',
    'revokedAt',
    'revokedByEmployeeId',
    'safeRevocationReason',
    'supersededAt',
    'supersededByInvitationId',
    'onboardingCompletedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    userAccountId: { type: 'string', format: 'uuid' },
    invitedEmailNormalized: { type: 'string', format: 'email', maxLength: 320 },
    status: {
      type: 'string',
      enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'SUPERSEDED'],
    },
    issuerEmployeeId: { type: 'string', format: 'uuid' },
    issuedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: nullableDateTime,
    revokedAt: nullableDateTime,
    revokedByEmployeeId: { type: 'string', format: 'uuid', nullable: true },
    safeRevocationReason: { type: 'string', maxLength: 500, nullable: true },
    supersededAt: nullableDateTime,
    supersededByInvitationId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
    },
    onboardingCompletedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const invitationIssueBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['employeeCode', 'firstName', 'lastName', 'displayName', 'workEmail'],
  properties: {
    employeeCode: { type: 'string', minLength: 1, maxLength: 64 },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    displayName: { type: 'string', minLength: 1, maxLength: 160 },
    workEmail: { type: 'string', format: 'email', maxLength: 320 },
  },
};

export const invitationIssueResponseSchema = successEnvelope({
  type: 'object',
  required: ['invitation', 'acceptanceUrl'],
  properties: {
    invitation: invitationSchema,
    acceptanceUrl: {
      type: 'string',
      description: 'One-time, no-store, fragment-based delivery. This value is never available from later APIs.',
    },
  },
});

export const invitationListSchema: SchemaObject = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: invitationSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
};

export const invitationRevokeBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Optional explicitly safe operational reason. Secrets are rejected.',
    },
  },
};

export const invitationInspectBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['invitationToken'],
  properties: {
    invitationToken: {
      type: 'string',
      writeOnly: true,
      description: 'The one-time invitation secret. Supply only in this HTTPS request body; never in a query or path.',
    },
  },
};

export const invitationInspectionSchema: SchemaObject = {
  type: 'object',
  required: ['status', 'expiresAt'],
  properties: {
    status: {
      type: 'string',
      enum: ['VALID', 'EXPIRED', 'REVOKED', 'SUPERSEDED', 'ALREADY_USED'],
    },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

export const invitationOnboardingStartBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['invitationToken', 'redirectUri'],
  properties: {
    ...invitationInspectBodySchema.properties,
    redirectUri: { type: 'string', format: 'uri' },
    loginHint: {
      type: 'string',
      maxLength: 160,
      description: 'Optional provider hint; never accepted as verified identity evidence.',
    },
  },
};

export const onboardingStartResponseSchema = authenticationStartResponseSchema;
export const invitationOnboardingCallbackSchema = authenticationCallbackBodySchema;
