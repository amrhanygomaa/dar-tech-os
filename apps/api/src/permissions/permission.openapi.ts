import type { SchemaObject } from "@nestjs/swagger";
import {
  errorEnvelopeSchema,
  successEnvelope,
} from "../identity/identity.openapi.js";
import { SCOPE_TYPES } from "./permission.contracts.js";

const nullableDateTime: SchemaObject = {
  type: "string",
  format: "date-time",
  nullable: true,
};
const nullableString: SchemaObject = { type: "string", nullable: true };

export const permissionSchema: SchemaObject = {
  type: "object",
  required: [
    "id",
    "key",
    "domain",
    "resource",
    "action",
    "description",
    "riskClassification",
    "active",
    "deprecatedAt",
    "replacementPermissionKey",
    "definitionVersion",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    key: {
      type: "string",
      maxLength: 160,
      pattern: "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
    },
    domain: { type: "string", maxLength: 64 },
    resource: { type: "string", maxLength: 64 },
    action: { type: "string", maxLength: 64 },
    description: { type: "string", maxLength: 500 },
    riskClassification: {
      type: "string",
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    active: { type: "boolean" },
    deprecatedAt: nullableDateTime,
    replacementPermissionKey: nullableString,
    definitionVersion: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export const rolePermissionSchema: SchemaObject = {
  type: "object",
  required: [
    "id",
    "organizationId",
    "roleId",
    "permissionId",
    "permission",
    "scopeType",
    "scopeBindingType",
    "scopeBindingId",
    "grantedByEmployeeId",
    "grantedAt",
    "effectiveAt",
    "expiresAt",
    "removedAt",
    "removedByEmployeeId",
    "effective",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    roleId: { type: "string", format: "uuid" },
    permissionId: { type: "string", format: "uuid" },
    permission: permissionSchema,
    scopeType: { type: "string", enum: [...SCOPE_TYPES] },
    scopeBindingType: { ...nullableString, maxLength: 80 },
    scopeBindingId: { ...nullableString, maxLength: 128 },
    grantedByEmployeeId: { type: "string", format: "uuid" },
    grantedAt: { type: "string", format: "date-time" },
    effectiveAt: { type: "string", format: "date-time" },
    expiresAt: nullableDateTime,
    removedAt: nullableDateTime,
    removedByEmployeeId: { type: "string", format: "uuid", nullable: true },
    effective: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export const grantRolePermissionSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["permissionKey", "scopeType"],
  properties: {
    permissionKey: {
      type: "string",
      maxLength: 160,
      pattern: "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
    },
    scopeType: {
      type: "string",
      enum: [...SCOPE_TYPES],
      description:
        "Stored scope contract only. T06 does not resolve project, customer, team, department, or assignment relationships.",
    },
    scopeBindingType: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      nullable: true,
    },
    scopeBindingId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      nullable: true,
    },
    expiresAt: nullableDateTime,
  },
};

export const permissionPageSchema: SchemaObject = {
  type: "object",
  required: ["items", "page", "pageSize", "total"],
  properties: {
    items: { type: "array", items: permissionSchema },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", minimum: 0 },
  },
};

export const rolePermissionPageSchema: SchemaObject = {
  type: "object",
  required: ["items", "page", "pageSize", "total"],
  properties: {
    items: { type: "array", items: rolePermissionSchema },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", minimum: 0 },
  },
};

export const permissionProtectedError = {
  schema: errorEnvelopeSchema,
  description:
    "The request lacks a trusted actor or an explicit T06 administration decision.",
};

export { errorEnvelopeSchema, successEnvelope };
