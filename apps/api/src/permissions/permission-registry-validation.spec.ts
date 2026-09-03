import { describe, expect, it } from "vitest";
import { PERMISSION_REGISTRY } from "./permission-manifest.js";
import { validatePermissionRegistryRecords } from "./permission-registry-validation.js";

function record(overrides: Record<string, unknown> = {}) {
  const definition = PERMISSION_REGISTRY[0]!;
  return {
    id: "018f53d4-2f68-7c52-a399-3df2364d9901",
    ...definition,
    ...overrides,
  };
}

describe("S02-T06 registry drift validation contract", () => {
  it("detects malformed, duplicate, active unknown, metadata, and version drift", () => {
    const [definition, driftedDefinition] = PERMISSION_REGISTRY;
    expect(definition).toBeDefined();
    expect(driftedDefinition).toBeDefined();
    const result = validatePermissionRegistryRecords(
      [definition!, driftedDefinition!],
      [
        record(),
        record({ id: "018f53d4-2f68-7c52-a399-3df2364d9902" }),
        record({
          id: "018f53d4-2f68-7c52-a399-3df2364d9903",
          key: "malformed.*",
          active: true,
        }),
        record({
          id: "018f53d4-2f68-7c52-a399-3df2364d9904",
          key: "unknown.permission.read",
          domain: "unknown",
          resource: "permission",
          action: "read",
          active: true,
        }),
        record({
          id: "018f53d4-2f68-7c52-a399-3df2364d9905",
          ...driftedDefinition,
          definitionVersion: 2,
          description: "drift",
        }),
      ],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "MALFORMED_KEY",
        "DUPLICATE_KEY",
        "ACTIVE_UNKNOWN_PERMISSION",
        "INCOMPATIBLE_DEFINITION_VERSION",
        "METADATA_MISMATCH",
      ]),
    );
  });

  it("detects a missing canonical key and invalid deprecated grant reference", () => {
    const [first, second] = PERMISSION_REGISTRY;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const deprecated = record({
      active: false,
      deprecatedAt: new Date(),
      key: first!.key,
    });
    const result = validatePermissionRegistryRecords(
      [first!, second!],
      [deprecated],
      [{ id: "018f53d4-2f68-7c52-a399-3df2364d9999", permission: deprecated }],
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REQUIRED_KEY_MISSING",
          permissionKey: second!.key,
        }),
        expect.objectContaining({
          code: "INVALID_GRANT_REFERENCE",
          permissionKey: first!.key,
        }),
      ]),
    );
  });
});
