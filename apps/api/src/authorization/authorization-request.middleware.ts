import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { applySessionCookie, hasValidCsrfOrigin, parseSessionCookie } from '../sessions/session-cookie.js';
import { sessionAuthorizationDenied } from '../sessions/session.errors.js';
import { SessionService } from '../sessions/session.service.js';
import { AuthorizationActorContext } from './authorization-context.js';
import type { AuthorizationActor } from './authorization.contracts.js';

const protectedPath = /^\/(?:me(?:\/|$)|employees(?:\/|$)|invitations(?:\/|$)|roles(?:\/|$)|permissions(?:\/|$)|audit-events(?:\/|$)|security-events(?:\/|$)|admin\/sessions(?:\/|$))/u;

function applicationPath(request: Request): string {
  return request.path.replace(/^\/api\/v1(?=\/|$)/u, '') || '/';
}

@Injectable()
export class AuthorizationRequestMiddleware implements NestMiddleware {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthorizationActorContext) private readonly actors: AuthorizationActorContext,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (!protectedPath.test(applicationPath(request))) {
      next();
      return;
    }
    void this.bind(request, response, next).catch(next);
  }

  private async bind(request: Request, response: Response, next: NextFunction): Promise<void> {
    const cookie = parseSessionCookie(request);
    // For unsafe methods with a present session cookie, enforce CSRF Origin
    // BEFORE session resolution to prevent the session touch (lastSeenAt /
    // idleExpiresAt update) from occurring on requests that will be denied.
    if (
      cookie.status === 'present' &&
      ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
      !hasValidCsrfOrigin(request, this.sessions.config.allowedOrigins)
    ) {
      const origin = request.headers.origin;
      this.sessions.recordCsrfDenied(typeof origin === 'string' ? 'foreign_origin' : 'missing_origin');
      next(sessionAuthorizationDenied());
      return;
    }
    const resolution = await this.sessions.resolveCookie(cookie);
    if (resolution.cookie) {
      applySessionCookie(response, resolution.cookie, this.sessions.config, new Date());
    }
    const actor: AuthorizationActor | null = resolution.principal
      ? { ...resolution.principal, actorType: 'employee' }
      : null;
    this.actors.run(actor, next);
  }
}
