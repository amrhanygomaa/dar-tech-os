import { describe, expect, it } from "vitest";
import { PERMISSION_EVENT_CONTRACTS } from "./permission.events.js";

describe("S02-T06 permission event contracts", () => {
  it("defines only the three authorized versioned contracts", () => {
    expect(PERMISSION_EVENT_CONTRACTS).toEqual({
      permissionRegistered: {
        name: "PermissionRegistered.v1",
        eventType: "identity.permission-registered",
        eventVersion: 1,
      },
      rolePermissionGranted: {
        name: "RolePermissionGranted.v1",
        eventType: "identity.role-permission-granted",
        eventVersion: 1,
      },
      rolePermissionRemoved: {
        name: "RolePermissionRemoved.v1",
        eventType: "identity.role-permission-removed",
        eventVersion: 1,
      },
    });
    expect(JSON.stringify(PERMISSION_EVENT_CONTRACTS)).not.toContain(
      "PermissionDeprecated",
    );
  });
});
