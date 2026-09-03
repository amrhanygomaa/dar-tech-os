import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import type { EmployeeRoleView, RolePage, RoleView } from './role.contracts.js';
import {
  assignRoleSchema,
  createRoleSchema,
  employeeRoleSchema,
  errorEnvelopeSchema,
  roleProtectedError,
  roleSchema,
  successEnvelope,
  updateRoleSchema,
} from './role.openapi.js';
import { RoleService } from './role.service.js';
import { SESSION_COOKIE_NAME } from '../sessions/session.contracts.js';

@ApiTags('Roles')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller('roles')
export class RolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'List organization-scoped roles; role names grant no authority' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({
    schema: successEnvelope({
      type: 'object',
      required: ['items', 'page', 'pageSize', 'total'],
      properties: {
        items: { type: 'array', items: roleSchema },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer' },
      },
    }),
  })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string): Promise<RolePage> {
    return this.roles.list(page, pageSize);
  }

  @Post()
  @ApiOperation({ summary: 'Create a customizable role with an immutable stable key' })
  @ApiBody({ schema: createRoleSchema })
  @ApiCreatedResponse({ schema: successEnvelope(roleSchema) })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  create(@Body() body: unknown): Promise<RoleView> {
    return this.roles.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update only a role name or description; the stable key is immutable' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: updateRoleSchema })
  @ApiOkResponse({ schema: successEnvelope(roleSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  update(@Param('id') id: string, @Body() body: unknown): Promise<RoleView> {
    return this.roles.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a role without deleting role or assignment history' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: successEnvelope(roleSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  archive(@Param('id') id: string): Promise<RoleView> {
    return this.roles.archive(id);
  }
}

@ApiTags('Employee roles')
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller('employees')
export class EmployeeRolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Post(':id/roles')
  @ApiOperation({
    summary: 'Assign another historical role row; the role itself grants zero application authority',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: assignRoleSchema })
  @ApiCreatedResponse({ schema: successEnvelope(employeeRoleSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  assign(@Param('id') id: string, @Body() body: unknown): Promise<EmployeeRoleView> {
    return this.roles.assign(id, body);
  }

  @Post(':employeeId/roles/:roleId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historically remove an employee role assignment without deleting it' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiOkResponse({ schema: successEnvelope(employeeRoleSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(roleProtectedError)
  @ApiForbiddenResponse(roleProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  remove(
    @Param('employeeId') employeeId: string,
    @Param('roleId') roleId: string,
  ): Promise<EmployeeRoleView> {
    return this.roles.remove(employeeId, roleId);
  }
}
