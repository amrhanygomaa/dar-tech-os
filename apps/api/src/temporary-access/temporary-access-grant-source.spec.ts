import { describe, expect, it, vi } from "vitest";
import { PrismaAuthorizationTemporaryGrantSource } from "./temporary-access-grant-source.js";
import { canonicalPermissionDefinition } from "../permissions/permission-manifest.js";

const at = new Date("2026-09-06T12:00:00.000Z");
const definition = canonicalPermissionDefinition("admin.employee.read")!;

describe("PrismaAuthorizationTemporaryGrantSource", () => {
  it("only queries active, unrevoked grants that outlive the authorization instant", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        permissionKey: definition.key,
        permissionRiskSnapshot: definition.riskClassification,
        scopeType: "EXPLICIT",
        scopeBindingType: null,
        scopeBindingId: null,
        permission: { ...definition },
      },
    ]);
    const source = new PrismaAuthorizationTemporaryGrantSource({
      temporaryAccessBinding: { findMany },
    } as never);

    await expect(
      source.listGrants({
        actor: {
          actorType: "employee",
          sessionId: "session-1",
          organizationId: "org-1",
          employeeId: "employee-1",
          userAccountId: "account-1",
          clientKind: "browser",
          assuranceLevel: "mfa",
          authenticatedAt: at,
          lastStepUpAt: null,
          issuedAt: at,
          lastSeenAt: at,
          idleExpiresAt: new Date(at.getTime() + 60_000),
          absoluteExpiresAt: new Date(at.getTime() + 60_000),
        },
        action: definition.key,
        resource: {
          type: "employee",
          organizationId: "org-1",
          id: "employee-2",
        },
        context: { at, source: "test" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        permissionKey: definition.key,
        scopeType: "EXPLICIT",
      }),
    ]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          grant: expect.objectContaining({
            status: "GRANTED",
            revokedAt: null,
            startsAt: { lte: at },
            expiresAt: { gt: at },
          }),
        }),
      }),
    );
  });

  it("does not project a stale or noncanonical permission record into authorization", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        permissionKey: definition.key,
        permissionRiskSnapshot: "CRITICAL",
        scopeType: "EXPLICIT",
        scopeBindingType: null,
        scopeBindingId: null,
        permission: { ...definition },
      },
    ]);
    const source = new PrismaAuthorizationTemporaryGrantSource({
      temporaryAccessBinding: { findMany },
    } as never);

    await expect(
      source.listGrants({
        actor: {
          actorType: "employee",
          sessionId: "s",
          organizationId: "org-1",
          employeeId: "employee-1",
          userAccountId: "account-1",
          clientKind: "browser",
          assuranceLevel: "mfa",
          authenticatedAt: at,
          lastStepUpAt: null,
          issuedAt: at,
          lastSeenAt: at,
          idleExpiresAt: at,
          absoluteExpiresAt: at,
        },
        action: definition.key,
        resource: {
          type: "employee",
          organizationId: "org-1",
          id: "employee-2",
        },
        context: { at, source: "test" },
      }),
    ).resolves.toEqual([]);
  });
});
