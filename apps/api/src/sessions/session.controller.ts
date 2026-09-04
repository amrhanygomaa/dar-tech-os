import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  SESSION_COOKIE_NAME,
  type SessionPage,
  type SessionPrincipal,
  type SessionView,
} from './session.contracts.js';
import { applySessionCookie } from './session-cookie.js';
import { sessionAuthenticationRequired } from './session.errors.js';
import { AuthorizationActorContext } from '../authorization/authorization-context.js';
import {
  errorEnvelopeSchema,
  revokeAllBodySchema,
  revokeAllResultSchema,
  revokeResultSchema,
  sessionSchema,
  successEnvelope,
} from './session.openapi.js';
import { SessionService } from './session.service.js';

type RevokeResult = {
  readonly status: 'revoked' | 'idempotent';
  readonly currentSessionRevoked: boolean;
};
type RevokeAllResult = {
  readonly revokedCount: number;
  readonly currentSessionRevoked: boolean;
};

abstract class SessionControllerBase {
  constructor(
    protected readonly sessions: SessionService,
    private readonly actors: AuthorizationActorContext,
  ) {}

  protected actor(): SessionPrincipal {
    const actor = this.actors.currentActor();
    if (!actor) throw sessionAuthenticationRequired();
    return actor;
  }

  protected clearIfCurrent(response: Response, currentSessionRevoked: boolean): void {
    if (currentSessionRevoked) {
      applySessionCookie(response, { kind: 'clear' }, this.sessions.config, new Date());
    }
  }
}

@ApiTags('Sessions')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller('me/sessions')
export class SessionSelfController extends SessionControllerBase {
  constructor(
    @Inject(SessionService) sessions: SessionService,
    @Inject(AuthorizationActorContext) actors: AuthorizationActorContext,
  ) {
    super(sessions, actors);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List the current account session history' })
  @ApiOkResponse({ schema: successEnvelope({ type: 'array', items: sessionSchema }) })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  async list(): Promise<readonly SessionView[]> {
    const actor = this.actor();
    return this.sessions.listSelf(actor);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Revoke one session owned by the current account' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOkResponse({ schema: revokeResultSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  async revoke(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RevokeResult> {
    const actor = this.actor();
    const result = await this.sessions.revokeSelf(actor, id);
    this.clearIfCurrent(response, result.currentSessionRevoked);
    return result;
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Revoke current-account sessions with explicit current-session handling' })
  @ApiBody({ schema: revokeAllBodySchema })
  @ApiOkResponse({ schema: revokeAllResultSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  async revokeAll(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RevokeAllResult> {
    const actor = this.actor();
    const result = await this.sessions.revokeAllSelf(actor, body);
    this.clearIfCurrent(response, result.currentSessionRevoked);
    return result;
  }
}

@ApiTags('Session administration')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller()
export class SessionAdministrationController extends SessionControllerBase {
  constructor(
    @Inject(SessionService) sessions: SessionService,
    @Inject(AuthorizationActorContext) actors: AuthorizationActorContext,
  ) {
    super(sessions, actors);
  }

  @Get('admin/sessions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List safe session metadata in the trusted actor organization' })
  @ApiQuery({ name: 'employeeId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({
    schema: successEnvelope({
      type: 'object',
      required: ['items', 'page', 'pageSize', 'total'],
      properties: {
        items: {
          type: 'array',
          items: {
            ...sessionSchema,
            required: [...(sessionSchema.required ?? []), 'employeeId', 'userAccountId'],
            properties: {
              ...sessionSchema.properties,
              employeeId: { type: 'string', format: 'uuid' },
              userAccountId: { type: 'string', format: 'uuid' },
            },
          },
        },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
      },
    }),
  })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<SessionPage> {
    const actor = this.actor();
    return this.sessions.listAdministration(actor, employeeId, page, pageSize);
  }

  @Post('admin/sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Administratively revoke one organization session' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ schema: revokeResultSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  async revoke(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RevokeResult> {
    const actor = this.actor();
    const result = await this.sessions.revokeAdministration(actor, id);
    this.clearIfCurrent(response, result.currentSessionRevoked);
    return result;
  }

  @Post('employees/:id/sessions/revoke-all')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Administratively revoke sessions for one organization employee' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: revokeAllBodySchema })
  @ApiOkResponse({ schema: revokeAllResultSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  async revokeAll(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RevokeAllResult> {
    const actor = this.actor();
    const result = await this.sessions.revokeAllAdministration(actor, id, body);
    this.clearIfCurrent(response, result.currentSessionRevoked);
    return result;
  }
}
