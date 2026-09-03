import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {
  PublicAuthenticationCallback,
  PublicAuthenticationProvider,
  PublicAuthenticationStart,
  PublicProviderLogoutStart,
} from './auth.contracts.js';
import {
  authenticationCallbackBodySchema,
  authenticationCallbackResponseSchema,
  authenticationStartBodySchema,
  authenticationStartResponseSchema,
  errorEnvelopeSchema,
  providerListSchema,
  providerLogoutBodySchema,
  providerLogoutResponseSchema,
} from './auth.openapi.js';
import { AuthenticationService } from './auth.service.js';
import { authenticationFailed } from './auth.errors.js';
import { successEnvelope } from '../identity/identity.openapi.js';
import { applySessionCookie, parseSessionCookie } from '../sessions/session-cookie.js';
import { SessionService } from '../sessions/session.service.js';

const safeAuthenticationFailure = {
  description: 'Authentication failed. The response does not disclose account or invitation state.',
  schema: errorEnvelopeSchema,
};

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(
    @Inject(AuthenticationService) private readonly authentication: AuthenticationService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List configured internal authentication providers' })
  @ApiOkResponse({ schema: successEnvelope(providerListSchema) })
  listProviders(): readonly PublicAuthenticationProvider[] {
    return this.authentication.listProviders();
  }

  @Post(':providerKey/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start provider authentication without creating a Dar Tech session' })
  @ApiParam({ name: 'providerKey', type: 'string' })
  @ApiBody({ schema: authenticationStartBodySchema })
  @ApiOkResponse({ schema: authenticationStartResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(safeAuthenticationFailure)
  start(
    @Param('providerKey') providerKey: string,
    @Body() body: unknown,
  ): Promise<PublicAuthenticationStart> {
    return this.authentication.start(providerKey, body);
  }

  @Post(':providerKey/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a linked account and establish a rotated opaque application session',
  })
  @ApiParam({ name: 'providerKey', type: 'string' })
  @ApiBody({ schema: authenticationCallbackBodySchema })
  @ApiOkResponse({ schema: authenticationCallbackResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(safeAuthenticationFailure)
  async callback(
    @Param('providerKey') providerKey: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthenticationCallback> {
    const outcome = await this.authentication.verify(providerKey, body);
    if (outcome.principal.kind !== 'linked_account') throw authenticationFailed();
    try {
      const established = await this.sessions.establish(
        {
          organizationId: outcome.principal.organizationId,
          employeeId: outcome.principal.employeeId,
          userAccountId: outcome.principal.userAccountId,
        },
        outcome.identity,
        parseSessionCookie(request),
      );
      applySessionCookie(
        response,
        established.cookie,
        this.sessions.config,
        established.principal.issuedAt,
      );
      return {
        status: outcome.status,
        providerKey: outcome.providerKey,
        sessionCreated: true,
        nextStep: 'SESSION_ESTABLISHED',
      };
    } catch {
      throw authenticationFailed();
    }
  }

  @Post(':providerKey/provider-logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate provider logout only; this does not revoke a Dar Tech application session',
  })
  @ApiParam({ name: 'providerKey', type: 'string' })
  @ApiBody({ schema: providerLogoutBodySchema })
  @ApiOkResponse({ schema: providerLogoutResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(safeAuthenticationFailure)
  providerLogout(
    @Param('providerKey') providerKey: string,
    @Body() body: unknown,
  ): Promise<PublicProviderLogoutStart> {
    return this.authentication.startProviderLogout(providerKey, body);
  }
}
