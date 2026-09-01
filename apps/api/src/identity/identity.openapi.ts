import type { SchemaObject } from '@nestjs/swagger';

const dateTime: SchemaObject = { type: 'string', format: 'date-time', nullable: true };

export const employeeSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'employeeCode',
    'firstName',
    'lastName',
    'displayName',
    'workEmail',
    'lifecycleStatus',
    'invitedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    employeeCode: { type: 'string', maxLength: 64 },
    firstName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', maxLength: 100 },
    displayName: { type: 'string', maxLength: 160 },
    workEmail: { type: 'string', format: 'email', maxLength: 320 },
    lifecycleStatus: {
      type: 'string',
      enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'ARCHIVED'],
    },
    invitedAt: { type: 'string', format: 'date-time' },
    activatedAt: dateTime,
    suspendedAt: dateTime,
    offboardingAt: dateTime,
    archivedAt: dateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const accountSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'employeeId',
    'authenticationEligible',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    authenticationEligible: { type: 'boolean' },
    activatedAt: dateTime,
    disabledAt: dateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const employeeDetailSchema: SchemaObject = {
  ...employeeSchema,
  required: [...(employeeSchema.required ?? []), 'userAccount'],
  properties: {
    ...employeeSchema.properties,
    userAccount: { ...accountSchema, nullable: true },
  },
};

export const selfIdentitySchema: SchemaObject = {
  type: 'object',
  required: ['organization', 'employee', 'userAccount'],
  properties: {
    organization: {
      type: 'object',
      required: ['id', 'displayName'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        displayName: { type: 'string' },
      },
    },
    employee: employeeSchema,
    userAccount: accountSchema,
  },
};

export const adminEmployeePatchSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    displayName: { type: 'string', minLength: 1, maxLength: 160 },
    workEmail: { type: 'string', format: 'email', maxLength: 320 },
  },
};

export const selfPatchSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['displayName'],
  properties: {
    displayName: { type: 'string', minLength: 1, maxLength: 160 },
  },
};

export function successEnvelope(data: SchemaObject): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data,
      meta: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
      },
    },
  };
}

export const errorEnvelopeSchema: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};
