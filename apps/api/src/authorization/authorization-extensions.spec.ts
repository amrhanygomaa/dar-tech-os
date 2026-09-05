import { describe, expect, it, vi } from "vitest";
import { DefaultAuthorizationTemporaryGrantSource } from "./authorization-extensions.js";
import { AUTHORIZATION_TEMPORARY_GRANT_LOOKUP } from "./authorization.contracts.js";

const at = new Date("2026-09-06T12:00:00.000Z");
const input = {
  actor: {
    actorType: "employee" as const,
    sessionId: "session-1",
    organizationId: "organization-1",
    employeeId: "employee-1",
    userAccountId: "account-1",
    clientKind: "browser" as const,
    assuranceLevel: "mfa" as const,
    authenticatedAt: at,
    lastStepUpAt: null,
    issuedAt: at,
    lastSeenAt: at,
    idleExpiresAt: at,
    absoluteExpiresAt: at,
  },
  action: "admin.employee.read",
  resource: {
    type: "employee" as const,
    organizationId: "organization-1",
    id: "employee-2",
  },
  context: { at, source: "test" as const },
};

describe("DefaultAuthorizationTemporaryGrantSource", () => {
  it("is empty when T10 is not registered", async () => {
    await expect(
      new DefaultAuthorizationTemporaryGrantSource().listGrants(input),
    ).resolves.toEqual([]);
  });

  it("uses the T10 lookup without making the central engine a direct database caller", async () => {
    const listGrants = vi
      .fn()
      .mockResolvedValue([
        {
          permissionKey: "admin.employee.read",
          riskClassification: "LOW",
          scopeType: "EXPLICIT",
          scopeBindingType: null,
          scopeBindingId: null,
        },
      ]);
    const source = new DefaultAuthorizationTemporaryGrantSource({
      get: vi.fn().mockReturnValue({ listGrants }),
    } as never);

    await expect(source.listGrants(input)).resolves.toEqual([
      expect.objectContaining({ permissionKey: "admin.employee.read" }),
    ]);
    expect(source["moduleRef"]?.get).toHaveBeenCalledWith(
      AUTHORIZATION_TEMPORARY_GRANT_LOOKUP,
      { strict: false },
    );
    expect(listGrants).toHaveBeenCalledWith(input);
  });
});
