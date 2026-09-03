import { describe, expect, it } from "vitest";
import { PermissionModule } from "./permission.module.js";
import {
  DenyAllPermissionActorAdapter,
  DenyAllPermissionAdministrationAuthorizationAdapter,
} from "./permission-security.adapters.js";

describe("S02-T06 permission security composition", () => {
  it.each(["development", "staging", "production"] as const)(
    "refuses actor or authorization test adapters in %s",
    (environment) => {
      expect(() =>
        PermissionModule.register(environment, {
          actors: { currentActor: () => Promise.resolve(null) },
        }),
      ).toThrow(
        "Permission test adapters are available only in the test environment",
      );
    },
  );

  it("allows explicit deny adapters only in APP_ENV=test", () => {
    expect(() =>
      PermissionModule.register("test", {
        actors: { currentActor: () => Promise.resolve(null) },
        authorization: { allows: () => Promise.resolve(false) },
      }),
    ).not.toThrow();
  });

  it("defaults both production security boundaries to deny", async () => {
    await expect(
      new DenyAllPermissionActorAdapter().currentActor(),
    ).resolves.toBeNull();
    await expect(
      new DenyAllPermissionAdministrationAuthorizationAdapter().allows({
        actor: {
          actorType: "employee",
          organizationId: "018f53d4-2f68-7c52-a399-3df2364d9901",
          employeeId: "018f53d4-2f68-7c52-a399-3df2364d9902",
          userAccountId: "018f53d4-2f68-7c52-a399-3df2364d9903",
        },
        action: "admin.permission.manage",
        resource: {
          type: "role-permission",
          organizationId: "018f53d4-2f68-7c52-a399-3df2364d9901",
        },
      }),
    ).resolves.toBe(false);
  });
});
