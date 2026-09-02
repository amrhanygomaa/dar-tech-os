import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuditEventView, Page, SecurityEventView } from './event-history.contracts.js';
import {
  parseAuditEventQuery,
  parseEventId,
  parseSecurityEventQuery,
} from './event-history-input.js';
import {
  auditEventSchema,
  eventHistoryEnvelope,
  eventHistoryErrorSchema,
  eventHistoryPage,
  securityEventSchema,
} from './event-history.openapi.js';
import { EventHistoryService } from './event-history.service.js';

const protectedError = {
  schema: eventHistoryErrorSchema,
  description: 'Trusted authentication and an explicit permission decision are required.',
};

@ApiTags('Audit events')
@Controller('audit-events')
export class AuditEventsController {
  constructor(@Inject(EventHistoryService) private readonly history: EventHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'List organization-scoped audit history' })
  @ApiQuery({
    name: 'actionKey',
    required: false,
    type: String,
    maxLength: 160,
  })
  @ApiQuery({
    name: 'targetType',
    required: false,
    type: String,
    maxLength: 80,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: 'occurredFrom',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({
    name: 'occurredTo',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiOkResponse({ schema: eventHistoryPage(auditEventSchema) })
  @ApiBadRequestResponse({ schema: eventHistoryErrorSchema })
  @ApiUnauthorizedResponse(protectedError)
  @ApiForbiddenResponse(protectedError)
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('actionKey') actionKey?: string,
    @Query('targetType') targetType?: string,
    @Query('occurredFrom') occurredFrom?: string,
    @Query('occurredTo') occurredTo?: string,
  ): Promise<Page<AuditEventView>> {
    const parsed = parseAuditEventQuery({
      ...(page ? { page } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...(actionKey ? { actionKey } : {}),
      ...(targetType ? { targetType } : {}),
      ...(occurredFrom ? { occurredFrom } : {}),
      ...(occurredTo ? { occurredTo } : {}),
    });
    return this.history.listAuditEvents(parsed.filters, parsed.page, parsed.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one organization-scoped audit event' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: eventHistoryEnvelope(auditEventSchema) })
  @ApiBadRequestResponse({ schema: eventHistoryErrorSchema })
  @ApiUnauthorizedResponse(protectedError)
  @ApiForbiddenResponse(protectedError)
  @ApiNotFoundResponse({ schema: eventHistoryErrorSchema })
  get(@Param('id') id: string): Promise<AuditEventView> {
    return this.history.getAuditEvent(parseEventId(id));
  }
}

@ApiTags('Security events')
@Controller('security-events')
export class SecurityEventsController {
  constructor(@Inject(EventHistoryService) private readonly history: EventHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'List organization-scoped security events' })
  @ApiQuery({
    name: 'eventType',
    required: false,
    type: String,
    maxLength: 160,
  })
  @ApiQuery({ name: 'category', required: false, type: String, maxLength: 80 })
  @ApiQuery({ name: 'outcome', required: false, type: String, maxLength: 64 })
  @ApiQuery({
    name: 'risk',
    required: false,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: 'occurredFrom',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({
    name: 'occurredTo',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiOkResponse({ schema: eventHistoryPage(securityEventSchema) })
  @ApiBadRequestResponse({ schema: eventHistoryErrorSchema })
  @ApiUnauthorizedResponse(protectedError)
  @ApiForbiddenResponse(protectedError)
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('eventType') eventType?: string,
    @Query('category') category?: string,
    @Query('outcome') outcome?: string,
    @Query('risk') risk?: string,
    @Query('occurredFrom') occurredFrom?: string,
    @Query('occurredTo') occurredTo?: string,
  ): Promise<Page<SecurityEventView>> {
    const parsed = parseSecurityEventQuery({
      ...(page ? { page } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...(eventType ? { eventType } : {}),
      ...(category ? { category } : {}),
      ...(outcome ? { outcome } : {}),
      ...(risk ? { risk } : {}),
      ...(occurredFrom ? { occurredFrom } : {}),
      ...(occurredTo ? { occurredTo } : {}),
    });
    return this.history.listSecurityEvents(parsed.filters, parsed.page, parsed.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one organization-scoped security event' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: eventHistoryEnvelope(securityEventSchema) })
  @ApiBadRequestResponse({ schema: eventHistoryErrorSchema })
  @ApiUnauthorizedResponse(protectedError)
  @ApiForbiddenResponse(protectedError)
  @ApiNotFoundResponse({ schema: eventHistoryErrorSchema })
  get(@Param('id') id: string): Promise<SecurityEventView> {
    return this.history.getSecurityEvent(parseEventId(id));
  }
}
