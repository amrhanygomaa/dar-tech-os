import { describe, expect, it } from "vitest";
import { SCOPE_TYPES } from "./permission.contracts.js";
import {
  parseGrantRolePermission,
  parsePermissionKeyInput,
} from "./permission-input.js";

describe("S02-T06 role permission input", () => {
  it.each(SCOPE_TYPES)(
    "accepts approved %s scope structurally",
    (scopeType) => {
      const needsBinding = scopeType === "EXPLICIT";
      expect(
        parseGrantRolePermission({
          permissionKey: "admin.employee.read",
          scopeType,
          ...(needsBinding
            ? {
                scopeBindingType: "employee",
                scopeBindingId: "018f53d4-2f68-7c52-a399-3df2364d9901",
              }
            : {}),
        }),
      ).toMatchObject({ permissionKey: "admin.employee.read", scopeType });
    },
  );

  it("stores structurally valid opaque PROJECT and CUSTOMER bindings without lookup", () => {
    for (const scopeType of ["PROJECT", "CUSTOMER"] as const) {
      expect(
        parseGrantRolePermission({
          permissionKey: "admin.employee.read",
          scopeType,
          scopeBindingType: scopeType.toLowerCase(),
          scopeBindingId: "opaque:resource-1",
        }),
      ).toMatchObject({ scopeType, scopeBindingId: "opaque:resource-1" });
    }
  });

  it("requires paired EXPLICIT bindings and rejects bindings for SELF or ORGANIZATION", () => {
    expect(() =>
      parseGrantRolePermission({
        permissionKey: "admin.employee.read",
        scopeType: "EXPLICIT",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_INPUT_INVALID" }),
    );
    for (const scopeType of ["SELF", "ORGANIZATION"]) {
      expect(() =>
        parseGrantRolePermission({
          permissionKey: "admin.employee.read",
          scopeType,
          scopeBindingType: "project",
          scopeBindingId: "p1",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "PERMISSION_INPUT_INVALID" }),
      );
    }
  });

  it("rejects unknown scopes, malformed binding pairs, caller authority, wildcard, and uppercase keys", () => {
    for (const input of [
      { permissionKey: "admin.employee.read", scopeType: "WORLD" },
      {
        permissionKey: "admin.employee.read",
        scopeType: "PROJECT",
        scopeBindingType: "project",
      },
      {
        permissionKey: "admin.employee.read",
        scopeType: "PROJECT",
        scopeBindingType: "Project",
        scopeBindingId: "1",
      },
      {
        permissionKey: "admin.employee.read",
        scopeType: "ORGANIZATION",
        organizationId: "caller",
      },
      { permissionKey: "admin.*.read", scopeType: "ORGANIZATION" },
      { permissionKey: "Admin.employee.read", scopeType: "ORGANIZATION" },
    ]) {
      expect(() => parseGrantRolePermission(input)).toThrowError(
        expect.objectContaining({ code: "PERMISSION_INPUT_INVALID" }),
      );
    }
    expect(() =>
      parsePermissionKeyInput("admin.employee.read.extra"),
    ).toThrowError(
      expect.objectContaining({ code: "PERMISSION_INPUT_INVALID" }),
    );
  });
});
