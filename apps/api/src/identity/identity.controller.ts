import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { parseIdentityId, parsePagination } from './employee-profile.js';
import type { EmployeeDetailView, EmployeePage, SelfIdentityView } from './identity.contracts.js';
import {
  adminEmployeePatchSchema,
  employeeDetailSchema,
  errorEnvelopeSchema,
  selfIdentitySchema,
  selfPatchSchema,
  successEnvelope,
} from './identity.openapi.js';
import { IdentityService } from './identity.service.js';

const protectedErrors = {
  schema: errorEnvelopeSchema,
  description: 'The request lacks a trusted actor or an explicit authorization decision.',
};

@ApiTags('Identity')
@Controller('me')
export class MeController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'Read the authenticated employee account context' })
  @ApiOkResponse({
    schema: successEnvelope(selfIdentitySchema),
  })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  getMe(): Promise<SelfIdentityView> {
    return this.identity.getMe();
  }

  @Patch()
  @ApiOperation({ summary: 'Update the authenticated employee display name' })
  @ApiBody({ schema: selfPatchSchema })
  @ApiOkResponse({
    description: 'The authenticated identity view after the profile update.',
    schema: successEnvelope(selfIdentitySchema),
  })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  updateMe(@Body() body: unknown): Promise<SelfIdentityView> {
    return this.identity.updateMe(body);
  }
}

@ApiTags('Employees')
@Controller('employees')
export class EmployeesController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Get()
  @ApiOperation({ summary: 'List employees within the trusted actor organization' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({
    schema: successEnvelope({
      type: 'object',
      required: ['items', 'page', 'pageSize', 'total'],
      properties: {
        items: { type: 'array', items: employeeDetailSchema },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer' },
      },
    }),
  })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  listEmployees(
    @Query('page') pageInput?: string,
    @Query('pageSize') pageSizeInput?: string,
  ): Promise<EmployeePage> {
    const { page, pageSize } = parsePagination(pageInput, pageSizeInput);
    return this.identity.listEmployees(page, pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read an employee within the trusted actor organization' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: successEnvelope(employeeDetailSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  getEmployee(@Param('id') id: string): Promise<EmployeeDetailView> {
    return this.identity.getEmployee(parseIdentityId(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update non-lifecycle employee profile fields' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: adminEmployeePatchSchema })
  @ApiOkResponse({ schema: successEnvelope(employeeDetailSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(protectedErrors)
  @ApiForbiddenResponse(protectedErrors)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  updateEmployee(@Param('id') id: string, @Body() body: unknown): Promise<EmployeeDetailView> {
    return this.identity.updateEmployee(parseIdentityId(id), body);
  }
}
