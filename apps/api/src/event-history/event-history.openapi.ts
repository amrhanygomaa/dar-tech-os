import type { SchemaObject } from '@nestjs/swagger';

const nullableUuid: SchemaObject = {
  type: 'string',
  format: 'uuid',
  nullable: true,
};
const nullableString: SchemaObject = { type: 'string', nullable: true };

const historicalActorSnapshot: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { type: 'string', enum: ['employee', 'system', 'unresolved'] },
    displayName: { type: 'string', maxLength: 160 },
    employeeCode: { type: 'string', maxLength: 64 },
  },
};

const historicalTargetSnapshot: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', maxLength: 160 },
    employeeCode: { type: 'string', maxLength: 64 },
  },
};

export const auditEventSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'actionKey',
    'actorEmployeeId',
    'actorSnapshot',
    'targetType',
    'targetId',
    'requestId',
    'correlationId',
    'sessionReference',
    'safeReason',
    'approvalReference',
    'occurredAt',
    'createdAt',
    'eventVersion',
    'integrityVersion',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    actionKey: {
      type: 'string',
      enum: ['identity.account.update_self', 'admin.employee.update'],
    },
    actorEmployeeId: nullableUuid,
    actorSnapshot: historicalActorSnapshot,
    targetType: { type: 'string', maxLength: 80 },
    targetId: { type: 'string', maxLength: 128 },
    targetSnapshot: historicalTargetSnapshot,
    requestId: nullableString,
    correlationId: { type: 'string', maxLength: 128 },
    sessionReference: nullableString,
    safeReason: nullableString,
    changeDelta: {
      type: 'object',
      additionalProperties: false,
      required: ['changedFields'],
      properties: {
        changedFields: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 4,
        },
      },
    },
    approvalReference: nullableString,
    occurredAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    eventVersion: { type: 'integer', minimum: 1 },
    integrityVersion: { type: 'integer', minimum: 1 },
  },
};

export const securityEventSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'eventType',
    'category',
    'risk',
    'outcome',
    'actorEmployeeId',
    'actorAccountId',
    'providerKey',
    'sessionReference',
    'requestId',
    'correlationId',
    'occurredAt',
    'createdAt',
    'eventVersion',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: nullableUuid,
    eventType: {
      type: 'string',
      enum: ['AuthenticationSucceeded.v1', 'AuthenticationFailed.v1'],
    },
    category: { type: 'string', maxLength: 80 },
    risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    outcome: { type: 'string', maxLength: 64 },
    actorEmployeeId: nullableUuid,
    actorAccountId: nullableUuid,
    providerKey: nullableString,
    sessionReference: nullableString,
    actorSnapshot: historicalActorSnapshot,
    safeContext: {
      type: 'object',
      maxProperties: 16,
      additionalProperties: {
        oneOf: [{ type: 'string', maxLength: 256 }, { type: 'number' }, { type: 'boolean' }],
        nullable: true,
      },
    },
    requestId: nullableString,
    correlationId: { type: 'string', maxLength: 128 },
    networkContext: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string', maxLength: 2 },
        ipPrefix: { type: 'string', maxLength: 64 },
      },
    },
    deviceContext: {
      type: 'object',
      additionalProperties: false,
      properties: {
        deviceClass: { type: 'string', maxLength: 32 },
        userAgentFamily: { type: 'string', maxLength: 64 },
      },
    },
    occurredAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    eventVersion: { type: 'integer', minimum: 1 },
  },
};

export const eventHistoryErrorSchema: SchemaObject = {
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

export function eventHistoryEnvelope(data: SchemaObject): SchemaObject {
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

export function eventHistoryPage(item: SchemaObject): SchemaObject {
  return eventHistoryEnvelope({
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: item },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
    },
  });
}
