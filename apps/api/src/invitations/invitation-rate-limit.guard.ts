import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { InvitationConfig } from '@dar-tech/config';
import { rateLimitExceeded } from './invitation.errors.js';
import { INVITATION_CONFIG } from './invitation.contracts.js';

interface RateWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class OnboardingRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, RateWindow>();

  constructor(@Inject(INVITATION_CONFIG) private readonly config: InvitationConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    this.prune(now);
    const route = request.route?.path ?? 'onboarding';
    const key = `${request.ip || 'unresolved'}:${route}`;
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      if (this.windows.size >= 10_000) this.windows.delete(this.windows.keys().next().value ?? '');
      this.windows.set(key, {
        count: 1,
        resetAt: now + this.config.rateLimitWindowSeconds * 1_000,
      });
      return true;
    }
    current.count += 1;
    if (current.count > this.config.rateLimitMaxRequests) throw rateLimitExceeded();
    return true;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
