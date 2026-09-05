import { describe, expect, it } from "vitest";
import {
  parseTemporaryAccessCreate,
  parseTemporaryAccessList,
} from "./temporary-access-input.js";

const now = new Date("2026-09-06T12:00:00.000Z");
const idempotencyKey = "temporary-access-request-0001";

function request(overrides: Record<string, unknown> = {}) {
  return {
    reason: "Cover the finance reconciliation while the owner is away.",
    startsAt: "2026-09-06T12:00:00.000Z",
    expiresAt: "2026-09-06T13:00:00.000Z",
    bindings: [
      {
        permissionKey: "admin.employee.read",
        scopeType: "EXPLICIT",
        resourceType: "employee",
        resourceId: "employee-42",
      },
    ],
    ...overrides,
  };
}

describe("temporary access input boundary", () => {
  it("accepts a bounded explicit canonical permission grant", () => {
    const parsed = parseTemporaryAccessCreate(
      request(),
      idempotencyKey,
      now,
      7_200,
    );

    expect(parsed.reason).toContain("finance reconciliation");
    expect(parsed.bindings).toEqual([
      expect.objectContaining({
        permissionKey: "admin.employee.read",
        scopeType: "EXPLICIT",
      }),
    ]);
  });

  it.each([
    [
      "wildcard permission",
      request({
        bindings: [
          {
            permissionKey: "admin.*",
            scopeType: "EXPLICIT",
            resourceType: "employee",
            resourceId: "employee-42",
          },
        ],
      }),
    ],
    [
      "unknown permission",
      request({
        bindings: [
          {
            permissionKey: "admin.employee.delete",
            scopeType: "EXPLICIT",
            resourceType: "employee",
            resourceId: "employee-42",
          },
        ],
      }),
    ],
    [
      "self scope",
      request({
        bindings: [
          {
            permissionKey: "admin.employee.read",
            scopeType: "SELF",
            resourceType: "employee",
            resourceId: "employee-42",
          },
        ],
      }),
    ],
    [
      "organization resource id",
      request({
        bindings: [
          {
            permissionKey: "admin.employee.read",
            scopeType: "ORGANIZATION",
            resourceType: "employee",
            resourceId: "employee-42",
          },
        ],
      }),
    ],
    [
      "duplicate binding",
      request({ bindings: [request().bindings[0], request().bindings[0]] }),
    ],
    ["credential material", { ...request(), password: "never-accepted" }],
    ["expired time range", request({ expiresAt: "2026-09-06T12:00:00.000Z" })],
    [
      "duration over configured maximum",
      request({ expiresAt: "2026-09-06T15:00:01.000Z" }),
    ],
  ])("rejects %s", (_name, body) => {
    expect(() =>
      parseTemporaryAccessCreate(body, idempotencyKey, now, 7_200),
    ).toThrow();
  });

  it("rejects malformed idempotency material and list filters", () => {
    expect(() =>
      parseTemporaryAccessCreate(request(), "short", now, 7_200),
    ).toThrow();
    expect(() =>
      parseTemporaryAccessList("0", "101", "GRANTED", "not-a-uuid"),
    ).toThrow();
  });
});
