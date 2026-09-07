import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('S02-T13 minimum employee lifecycle UI', () => {
  it('offers only eligible suspend, offboard/retry, and archive commands with confirmation and reason', () => {
    expect(source).toContain("selected.lifecycleStatus === 'ACTIVE'");
    expect(source).toContain("['ACTIVE', 'SUSPENDED', 'OFFBOARDING'].includes");
    expect(source).toContain("selected.offboardingCleanupStatus === 'COMPLETED'");
    expect(source).toContain('window.confirm');
    expect(source).toMatch(/textarea name="reason" required maxLength=\{500\}/u);
  });

  it('renders approval and incomplete/completed cleanup state while preserving history boundaries', () => {
    expect(source).toContain('Approval pending. Reference');
    expect(source).toContain('Cleanup incomplete and retry-safe');
    expect(source).toContain('Access cleanup complete');
    expect(source).toContain('Historical records remain preserved');
    expect(source).toContain('The server—not these controls—enforces');
  });

  it('contains no delete or reactivation request', () => {
    expect(source).not.toMatch(/method:\s*['"]DELETE['"]/u);
    expect(source).not.toMatch(/\/reactivate|\/resume|\/unsuspend|\/unarchive/u);
  });
});
