import type { SchemaObject } from "@nestjs/swagger";
import {
  errorEnvelopeSchema,
  successEnvelope,
} from "../identity/identity.openapi.js";

const nullableDate: SchemaObject = {
  type: "string",
  format: "date-time",
  nullable: true,
};
export const approvalStepSchema: SchemaObject = {
  type: "object",
  required: [
    "id",
    "sequence",
    "status",
    "decidedByEmployeeId",
    "safeDecisionReason",
    "decidedAt",
    "version",
    "actionable",
    "canApprove",
    "canReject",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    sequence: { type: "integer", minimum: 1 },
    status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
    decidedByEmployeeId: { type: "string", format: "uuid", nullable: true },
    safeDecisionReason: { type: "string", maxLength: 500, nullable: true },
    decidedAt: nullableDate,
    version: { type: "integer", minimum: 1 },
    actionable: { type: "boolean" },
    canApprove: { type: "boolean" },
    canReject: { type: "boolean" },
  },
};
export const approvalSchema: SchemaObject = {
  type: "object",
  required: [
    "id",
    "organizationId",
    "requesterEmployeeId",
    "requesterSnapshot",
    "actionKey",
    "resourceType",
    "resourceId",
    "resourceSnapshot",
    "risk",
    "policyOutcome",
    "status",
    "safeRequestReason",
    "executionState",
    "executionResultReference",
    "version",
    "createdAt",
    "updatedAt",
    "steps",
    "history",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    requesterEmployeeId: { type: "string", format: "uuid" },
    requesterSnapshot: {
      type: "object",
      additionalProperties: false,
      properties: {
        displayName: { type: "string", maxLength: 160 },
        label: { type: "string", maxLength: 160 },
      },
    },
    actionKey: { type: "string", maxLength: 160 },
    resourceType: { type: "string", maxLength: 80 },
    resourceId: { type: "string", maxLength: 128, nullable: true },
    resourceSnapshot: {
      ...{
        type: "object",
        additionalProperties: false,
        properties: {
          displayName: { type: "string", maxLength: 160 },
          label: { type: "string", maxLength: 160 },
        },
      },
      nullable: true,
    },
    risk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    policyOutcome: {
      type: "string",
      enum: [
        "NO_APPROVAL",
        "SINGLE_APPROVER",
        "SEQUENTIAL_APPROVAL",
        "PARALLEL_APPROVAL",
        "STEP_UP_ONLY",
        "STEP_UP_AND_APPROVAL",
      ],
    },
    status: {
      type: "string",
      enum: [
        "PENDING",
        "IN_REVIEW",
        "APPROVED",
        "REJECTED",
        "EXECUTED",
        "FAILED",
      ],
    },
    safeRequestReason: { type: "string", maxLength: 500, nullable: true },
    executionState: {
      type: "string",
      enum: ["NOT_READY", "READY", "EXECUTING", "SUCCEEDED", "FAILED"],
    },
    executionResultReference: {
      type: "string",
      maxLength: 128,
      nullable: true,
    },
    version: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    steps: { type: "array", items: approvalStepSchema },
    history: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "category",
          "requestStatus",
          "executionState",
          "safeReason",
          "occurredAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          category: {
            type: "string",
            enum: [
              "REQUESTED",
              "STEP_APPROVED",
              "REQUEST_REJECTED",
              "APPROVAL_COMPLETED",
              "EXECUTION_STARTED",
              "EXECUTION_SUCCEEDED",
              "EXECUTION_FAILED",
            ],
          },
          requestStatus: { type: "string" },
          executionState: { type: "string" },
          safeReason: { type: "string", maxLength: 500, nullable: true },
          occurredAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};
export const approvalDecisionSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["stepId", "expectedVersion"],
  properties: {
    stepId: { type: "string", format: "uuid" },
    expectedVersion: { type: "integer", minimum: 1 },
    reason: { type: "string", maxLength: 500 },
  },
};
export const approvalProtectedError = {
  schema: errorEnvelopeSchema,
  description:
    "The resource is not disclosed unless the trusted actor is authorized.",
};
export { errorEnvelopeSchema, successEnvelope };
