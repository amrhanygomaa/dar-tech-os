import type { SchemaObject } from '@nestjs/swagger';
import { errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

const nullableDateTime: SchemaObject = { type: 'string', format: 'date-time', nullable: true };

export const roleSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'key',
    'name',
    'normalizedName',
    'description',
    'archived',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    key: { type: 'string', maxLength: 64, pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$' },
    name: { type: 'string', maxLength: 160 },
    normalizedName: { type: 'string', maxLength: 160 },
    description: { type: 'string', maxLength: 500, nullable: true },
    archived: { type: 'boolean' },
    archivedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const employeeRoleSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'employeeId',
    'roleId',
    'role',
    'assignedByEmployeeId',
    'assignedAt',
    'effectiveAt',
    'expiresAt',
    'removedAt',
    'removedByEmployeeId',
    'safeRemovalReason',
    'effective',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', format: 'uuid' },
    roleId: { type: 'string', format: 'uuid' },
    role: roleSchema,
    assignedByEmployeeId: { type: 'string', format: 'uuid' },
    assignedAt: { type: 'string', format: 'date-time' },
    effectiveAt: { type: 'string', format: 'date-time' },
    expiresAt: nullableDateTime,
    removedAt: nullableDateTime,
    removedByEmployeeId: { type: 'string', format: 'uuid', nullable: true },
    safeRemovalReason: { type: 'string', maxLength: 500, nullable: true },
    effective: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const createRoleSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 500, nullable: true },
  },
};

export const updateRoleSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 500, nullable: true },
  },
};

export const assignRoleSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['roleId'],
  properties: {
    roleId: { type: 'string', format: 'uuid' },
    expiresAt: nullableDateTime,
  },
};

export const roleProtectedError = {
  schema: errorEnvelopeSchema,
  description: 'The request lacks a trusted actor or an explicit authorization decision.',
};

export { errorEnvelopeSchema, successEnvelope };
