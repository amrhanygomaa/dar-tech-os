import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('S02-T05 role administration frontend boundary', () => {
  it('covers role create, edit, explicit archive, assign, and historical remove commands', () => {
    expect(source).toContain("`${API_BASE_URL}/roles`");
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain('/archive`');
    expect(source).toContain('/roles`');
    expect(source).toContain('/remove`');
    expect(source).not.toMatch(/method:\s*['"]DELETE['"]/u);
  });

  it('shows multi-role history and the explicit T06/T07 security boundary', () => {
    expect(source).toContain('Multiple simultaneous roles are preserved.');
    expect(source).toContain('Role names never authorize actions.');
    expect(source).toContain('/admin/permissions');
    expect(source).toMatch(/assignedAt.*effectiveAt.*expiresAt.*removedAt.*effective/su);
    expect(source).not.toMatch(/Founder override/iu);
  });

  it('contains loading, empty, unauthorized, forbidden, conflict, validation, and generic error states', () => {
    expect(source).toMatch(/loading.*ready.*unauthorized.*forbidden.*conflict.*validation.*error/su);
    expect(source).toContain('No roles have been created.');
  });
});
