import { describe, expect, it } from "vitest";
import {
  PERMISSION_REGISTRY,
  definePermissionRegistry,
  parsePermissionKey,
} from "./permission-manifest.js";

describe("S02-T06 canonical permission registry manifest", () => {
  it("contains exactly the 31 approved Sprint 02 keys once", () => {
    expect(PERMISSION_REGISTRY).toHaveLength(31);
    expect(new Set(PERMISSION_REGISTRY.map(({ key }) => key)).size).toBe(31);
    expect(PERMISSION_REGISTRY.map(({ key }) => key)).toContain(
      "admin.invitation.resend",
    );
    expect(PERMISSION_REGISTRY.map(({ key }) => key)).not.toContain(
      "admin.employee.delete",
    );
  });

  it("contains no future business-module permission", () => {
    const forbidden =
      /^(?:crm|sales|commercial|projects|qa|finance|licensing|support|knowledge|ai)\./u;
    expect(PERMISSION_REGISTRY.some(({ key }) => forbidden.test(key))).toBe(
      false,
    );
  });

  it("uses explicit critical technical risk without turning it into approval behavior", () => {
    const risks = Object.fromEntries(
      PERMISSION_REGISTRY.map(({ key, riskClassification }) => [
        key,
        riskClassification,
      ]),
    );
    expect(risks["admin.permission.manage"]).toBe("CRITICAL");
    expect(risks["admin.access.emergency"]).toBe("CRITICAL");
    expect(risks["admin.sso.manage"]).toBe("CRITICAL");
  });

  it("parses only bounded lowercase three-segment keys", () => {
    expect(parsePermissionKey("identity.account.read_self")).toEqual({
      domain: "identity",
      resource: "account",
      action: "read_self",
    });
    for (const key of [
      "ADMIN.role.read",
      "admin.role",
      "admin.role.read.extra",
      "admin.*.read",
      "*",
      "*.read",
      "admin.role.read self",
      "admin.role.read-",
      `a.b.${"x".repeat(160)}`,
    ]) {
      expect(() => parsePermissionKey(key)).toThrow(
        "Permission key is invalid",
      );
    }
  });

  it("rejects duplicate manifest definitions instead of choosing an alias", () => {
    const definition = PERMISSION_REGISTRY[0];
    expect(definition).toBeDefined();
    expect(() => definePermissionRegistry([definition!, definition!])).toThrow(
      "Permission registry definition is invalid or duplicated",
    );
  });
});
