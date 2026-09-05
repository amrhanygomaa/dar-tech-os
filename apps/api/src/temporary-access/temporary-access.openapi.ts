import type { SchemaObject } from "@nestjs/swagger";
import {
  errorEnvelopeSchema,
  successEnvelope,
} from "../identity/identity.openapi.js";

const bindingSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["permissionKey", "scopeType", "resourceType"],
  properties: {
    id: { type: "string", format: "uuid" },
    permissionKey: { type: "string", maxLength: 160 },
    riskClassification: {
      type: "string",
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    scopeType: {
      type: "string",
      enum: [
        "ASSIGNED",
        "TEAM",
        "DEPARTMENT",
        "PROJECT",
        "CUSTOMER",
        "ORGANIZATION",
        "EXPLICIT",
      ],
    },
    resourceType: { type: "string", maxLength: 80 },
    resourceId: { type: "string", maxLength: 128, nullable: true },
  },
};

export const temporaryAccessCreateSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "startsAt", "expiresAt", "bindings"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 500 },
    startsAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    approvalReference: { type: "string", format: "uuid" },
    bindings: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: bindingSchema,
    },
  },
};

export const temporaryAccessSchema: SchemaObject = {
  type: "object",
  required: [
    "id",
    "organizationId",
    "issuerEmployeeId",
    "recipientEmployeeId",
    "issuerSnapshot",
    "recipientSnapshot",
    "reason",
    "startsAt",
    "expiresAt",
    "storedStatus",
    "status",
    "approvalReference",
    "requestedAt",
    "grantedAt",
    "revokedAt",
    "revokedByEmployeeId",
    "bindings",
    "canRevoke",
    "createdAt",
    "updatedAt",
    "version",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    issuerEmployeeId: { type: "string", format: "uuid" },
    recipientEmployeeId: { type: "string", format: "uuid" },
    issuerSnapshot: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    recipientSnapshot: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    reason: { type: "string", maxLength: 500 },
    startsAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
    storedStatus: {
      type: "string",
      enum: ["PENDING_APPROVAL", "GRANTED", "REVOKED", "EXPIRED"],
    },
    status: {
      type: "string",
      enum: ["PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "REVOKED", "EXPIRED"],
    },
    approvalReference: { type: "string", format: "uuid", nullable: true },
    requestedAt: { type: "string", format: "date-time" },
    grantedAt: { type: "string", format: "date-time", nullable: true },
    revokedAt: { type: "string", format: "date-time", nullable: true },
    revokedByEmployeeId: { type: "string", format: "uuid", nullable: true },
    bindings: { type: "array", items: bindingSchema },
    canRevoke: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    version: { type: "integer", minimum: 1 },
  },
};

export const temporaryAccessPageSchema = successEnvelope({
  type: "object",
  required: ["items", "page", "pageSize", "total"],
  properties: {
    items: { type: "array", items: temporaryAccessSchema },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", minimum: 0 },
  },
});

export const temporaryAccessResponseSchema = successEnvelope(
  temporaryAccessSchema,
);
export const temporaryAccessRevokeSchema = successEnvelope({
  type: "object",
  required: ["outcome", "grant"],
  properties: {
    outcome: { type: "string", enum: ["revoked", "idempotent"] },
    grant: temporaryAccessSchema,
  },
});
export { errorEnvelopeSchema };
