import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

describe("S02-T06 permission administration frontend boundary", () => {
  it("loads the catalog and reloadable persisted role permission history", () => {
    expect(source).toContain(
      "`${API_BASE_URL}/permissions?page=1&pageSize=100`",
    );
    expect(source).toContain("/permissions?page=1&pageSize=100`");
    expect(source).toContain("Persisted grant history loaded.");
    expect(source).not.toMatch(/sessionStorage|localStorage/u);
  });

  it("supports grant and historical remove without definition mutation or DELETE", () => {
    expect(source).toMatch(/method:\s*["']POST["']/u);
    expect(source).toContain("/remove`");
    expect(source).not.toMatch(/method:\s*['"](?:PATCH|DELETE)['"]/u);
  });

  it("shows catalog metadata, all scope storage types, and required UI states", () => {
    expect(source).toMatch(
      /key.*domain.*resource.*action.*description.*riskClassification.*active.*deprecatedAt/su,
    );
    expect(source).toMatch(
      /SELF.*ASSIGNED.*TEAM.*DEPARTMENT.*PROJECT.*CUSTOMER.*ORGANIZATION.*EXPLICIT/su,
    );
    expect(source).toMatch(
      /loading.*ready.*unauthorized.*forbidden.*conflict.*validation.*error/su,
    );
    expect(source).toContain("T06 does not authorize application actions.");
    expect(source).toMatch(
      /Risk is\s+technical metadata, not an approval decision/u,
    );
  });
});
