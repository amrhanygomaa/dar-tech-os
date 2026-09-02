import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OnboardingRateLimitGuard } from './invitation-rate-limit.guard.js';

function context(ip: string, route: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, route: { path: route } }) }),
  } as unknown as ExecutionContext;
}

describe('onboarding rate limiter', () => {
  it('bounds requests by technical route and network source without token/email labels', () => {
    const guard = new OnboardingRateLimitGuard({
      ttlSeconds: 300,
      rateLimitMaxRequests: 2,
      rateLimitWindowSeconds: 60,
    });
    const requestContext = context('127.0.0.1', 'invitation/inspect');
    expect(guard.canActivate(requestContext)).toBe(true);
    expect(guard.canActivate(requestContext)).toBe(true);
    expect(() => guard.canActivate(requestContext)).toThrowError(
      expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 }),
    );
    expect(guard.canActivate(context('127.0.0.2', 'invitation/inspect'))).toBe(true);
  });
});
