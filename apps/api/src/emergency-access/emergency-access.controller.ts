import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from '../sessions/session.contracts.js';
import type { EmergencyAccessGrantView, EmergencyAccessPage } from './emergency-access.contracts.js';
import {
  emergencyAccessActionSchema,
  emergencyAccessPageSchema,
  emergencyAccessRequestSchema,
  emergencyAccessResponseSchema,
  errorEnvelopeSchema,
} from './emergency-access.openapi.js';
import { EmergencyAccessService } from './emergency-access.service.js';

@ApiTags('Emergency access')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller('emergency-access')
export class EmergencyAccessController {
  constructor(@Inject(EmergencyAccessService) private readonly emergencyAccess: EmergencyAccessService) {}

  @Post('requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request exact policy- and step-up-controlled emergency access' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Opaque duplicate-suppression material; hashed before persistence.' })
  @ApiBody({ schema: emergencyAccessRequestSchema })
  @ApiOkResponse({ schema: emergencyAccessResponseSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  request(@Body() body: unknown, @Headers('idempotency-key') idempotencyKey?: string): Promise<EmergencyAccessGrantView> {
    return this.emergencyAccess.request(body, idempotencyKey);
  }

  @Get()
  @ApiOperation({ summary: 'List organization-scoped emergency access records' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING_APPROVAL', 'ACTIVATION_ELIGIBLE', 'ACTIVE', 'DENIED', 'REVOKED', 'EXPIRED'] })
  @ApiQuery({ name: 'recipientEmployeeId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'risk', required: false, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @ApiOkResponse({ schema: emergencyAccessPageSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string, @Query('recipientEmployeeId') recipientEmployeeId?: string, @Query('risk') risk?: string): Promise<EmergencyAccessPage> {
    return this.emergencyAccess.list(page, pageSize, status, recipientEmployeeId, risk);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one authorized emergency access record' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ schema: emergencyAccessResponseSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  detail(@Param('id') id: string): Promise<EmergencyAccessGrantView> {
    return this.emergencyAccess.detail(id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Explicitly activate eligible emergency access after current revalidation' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ schema: emergencyAccessActionSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  activate(@Param('id') id: string) {
    return this.emergencyAccess.activate(id);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Immediately and idempotently revoke emergency access' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOkResponse({ schema: emergencyAccessActionSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  revoke(@Param('id') id: string) {
    return this.emergencyAccess.revoke(id);
  }
}
