import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from '../sessions/session.contracts.js';
import type { LifecycleCommandResult } from './offboarding.contracts.js';
import {
  archiveCommandSchema,
  errorEnvelopeSchema,
  lifecycleCommandResponseSchema,
  lifecycleReasonSchema,
} from './offboarding.openapi.js';
import { OffboardingService } from './offboarding.service.js';

@ApiTags('Employee access lifecycle')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller('employees')
export class OffboardingController {
  constructor(@Inject(OffboardingService) private readonly offboarding: OffboardingService) {}

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend an active employee and immediately disable authentication' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: lifecycleReasonSchema })
  @ApiOkResponse({ description: 'Suspended, idempotent, or approval-required result.', schema: lifecycleCommandResponseSchema })
  @ApiUnauthorizedResponse({ description: 'Trusted cookie authentication is required.', schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ description: 'Permission, scope, policy, approval, step-up, or exact-Origin validation denied.', schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ description: 'Absent and cross-organization employees share this response.', schema: errorEnvelopeSchema })
  @ApiConflictResponse({ description: 'The current lifecycle does not permit suspension.', schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ description: 'Reason or approval reference is invalid; unknown fields are rejected.', schema: errorEnvelopeSchema })
  suspend(@Param('id') id: string, @Body() body: unknown): Promise<LifecycleCommandResult> {
    return this.offboarding.suspend(id, body);
  }

  @Post(':id/offboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request or explicitly execute approved employee offboarding' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: lifecycleReasonSchema })
  @ApiOkResponse({ description: 'Approval-required, cleanup-complete, or safely incomplete result.', schema: lifecycleCommandResponseSchema })
  @ApiUnauthorizedResponse({ description: 'Trusted cookie authentication is required.', schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ description: 'Offboarding always fails closed without a valid approval-capable policy and exact approved reference.', schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ description: 'Absent and cross-organization employees share this response.', schema: errorEnvelopeSchema })
  @ApiConflictResponse({ description: 'Lifecycle, approval, idempotency context, or concurrent execution conflicts.', schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ description: 'Reason or approval reference is invalid; unknown fields are rejected.', schema: errorEnvelopeSchema })
  offboard(@Param('id') id: string, @Body() body: unknown): Promise<LifecycleCommandResult> {
    return this.offboarding.offboard(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an employee only after verified offboarding cleanup' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: archiveCommandSchema, required: false })
  @ApiOkResponse({ description: 'Archived or safely idempotent result.', schema: lifecycleCommandResponseSchema })
  @ApiUnauthorizedResponse({ description: 'Trusted cookie authentication is required.', schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ description: 'Current admin.employee.offboard authority is required.', schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ description: 'Absent and cross-organization employees share this response.', schema: errorEnvelopeSchema })
  @ApiConflictResponse({ description: 'Cleanup or the OFFBOARDING lifecycle gate is not complete.', schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ description: 'Archive accepts no lifecycle or account fields.', schema: errorEnvelopeSchema })
  archive(@Param('id') id: string, @Body() body: unknown): Promise<LifecycleCommandResult> {
    return this.offboarding.archive(id, body);
  }
}
