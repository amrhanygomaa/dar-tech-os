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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type {
  InvitationAcceptanceResult,
  InvitationInspection,
  InvitationPage,
  InvitationView,
  IssuedInvitation,
} from './invitation.contracts.js';
import {
  errorEnvelopeSchema,
  invitationInspectBodySchema,
  invitationInspectionSchema,
  invitationIssueBodySchema,
  invitationIssueResponseSchema,
  invitationListSchema,
  invitationOnboardingCallbackSchema,
  invitationOnboardingStartBodySchema,
  invitationRevokeBodySchema,
  invitationSchema,
  onboardingStartResponseSchema,
  successEnvelope,
} from './invitation.openapi.js';
import { InvitationService } from './invitation.service.js';
import { OnboardingRateLimitGuard } from './invitation-rate-limit.guard.js';
import { applySessionCookie, parseSessionCookie } from '../sessions/session-cookie.js';
import { SessionService } from '../sessions/session.service.js';

const protectedErrors = {
  schema: errorEnvelopeSchema,
  description: 'A trusted actor and explicit authorization decision are required.',
};

@ApiTags('Invitations')
@Controller()
export class InvitationController {
  constructor(@Inject(InvitationService) private readonly invitations: InvitationService) {}

  @Post('employees/invite')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Issue a one-time internal employee invitation',
    description:
      'Authorized internal use only. The fragment-based acceptance URL is returned once and is never persisted or available from list APIs.',
  })
  @ApiBody({ schema: invitationIssueBodySchema })
  @ApiCreatedResponse({ schema: invitationIssueResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  invite(@Body() body: unknown): Promise<IssuedInvitation> {
    return this.invitations.invite(body);
  }

  @Post('employees/:id/reinvite')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Generate a new invitation for an eligible previously invited employee',
    description:
      'Creates a new historical invitation and one-time fragment URL. Terminal invitations are never restored to pending.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCreatedResponse({ schema: invitationIssueResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  reinvite(@Param('id') id: string): Promise<IssuedInvitation> {
    return this.invitations.reinvite(id);
  }

  @Get('invitations')
  @ApiOperation({
    summary: 'List secret-free invitations in the trusted actor organization',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiOkResponse({ schema: successEnvelope(invitationListSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string): Promise<InvitationPage> {
    return this.invitations.list(page, pageSize);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a pending invitation explicitly and idempotently',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ schema: invitationRevokeBodySchema })
  @ApiOkResponse({ schema: successEnvelope(invitationSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  revoke(@Param('id') id: string, @Body() body: unknown): Promise<InvitationView> {
    return this.invitations.revoke(id, body);
  }

  @Post('invitations/:id/resend')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Supersede a usable pending invitation and generate a rotated link',
    description:
      'Invalidates the previous invitation immediately, creates a new historical record, and returns the new fragment URL once.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiCreatedResponse({ schema: invitationIssueResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  resend(@Param('id') id: string): Promise<IssuedInvitation> {
    return this.invitations.resend(id);
  }
}

@ApiTags('Onboarding')
@Controller('onboarding')
@UseGuards(OnboardingRateLimitGuard)
export class OnboardingController {
  constructor(
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('invitation/inspect')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Inspect an invitation secret supplied only in the HTTPS request body',
  })
  @ApiBody({ schema: invitationInspectBodySchema })
  @ApiOkResponse({ schema: successEnvelope(invitationInspectionSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({
    schema: errorEnvelopeSchema,
    description: 'The invitation could not be validated; employee/account existence is not disclosed.',
  })
  @ApiTooManyRequestsResponse({ schema: errorEnvelopeSchema })
  inspect(@Body() body: unknown): Promise<InvitationInspection> {
    return this.invitations.inspect(body);
  }

  @Post('auth/:providerKey/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Bind a validated invitation to a provider authentication transaction',
  })
  @ApiParam({ name: 'providerKey', type: 'string' })
  @ApiBody({ schema: invitationOnboardingStartBodySchema })
  @ApiOkResponse({ schema: onboardingStartResponseSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiTooManyRequestsResponse({ schema: errorEnvelopeSchema })
  start(@Param('providerKey') providerKey: string, @Body() body: unknown) {
    return this.invitations.startAuthentication(providerKey, body);
  }

  @Post('auth/:providerKey/callback')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Complete invitation onboarding, then establish an opaque application session',
  })
  @ApiParam({ name: 'providerKey', type: 'string' })
  @ApiBody({ schema: invitationOnboardingCallbackSchema })
  @ApiOkResponse({
    schema: successEnvelope({
      type: 'object',
      required: ['status', 'providerKey', 'sessionCreated', 'nextStep'],
      properties: {
        status: { type: 'string', enum: ['ONBOARDING_COMPLETED'] },
        providerKey: { type: 'string' },
        sessionCreated: { type: 'boolean' },
        nextStep: { type: 'string', enum: ['SESSION_ESTABLISHED', 'SIGN_IN_REQUIRED'] },
      },
    }),
  })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiTooManyRequestsResponse({ schema: errorEnvelopeSchema })
  async callback(
    @Param('providerKey') providerKey: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvitationAcceptanceResult> {
    const completed = await this.invitations.completeAuthentication(
      providerKey,
      body,
      parseSessionCookie(request),
    );
    if (completed.cookie) {
      applySessionCookie(
        response,
        completed.cookie,
        this.sessions.config,
        completed.cookie.issuedAt ?? new Date(),
      );
    }
    return completed.response;
  }
}
