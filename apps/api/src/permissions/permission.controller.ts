import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
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
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type {
  PermissionPage,
  RolePermissionPage,
  RolePermissionView,
} from "./permission.contracts.js";
import {
  errorEnvelopeSchema,
  grantRolePermissionSchema,
  permissionPageSchema,
  permissionProtectedError,
  rolePermissionPageSchema,
  rolePermissionSchema,
  successEnvelope,
} from "./permission.openapi.js";
import { PermissionService } from "./permission.service.js";

@ApiTags("Permissions")
@Controller("permissions")
export class PermissionsController {
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List the synchronized product-global permission catalog",
    description:
      "Risk is technical security metadata, not an approval decision. T06 does not authorize application actions.",
  })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiOkResponse({ schema: successEnvelope(permissionPageSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(permissionProtectedError)
  @ApiForbiddenResponse(permissionProtectedError)
  list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<PermissionPage> {
    return this.permissions.list(page, pageSize);
  }
}

@ApiTags("Role permissions")
@Controller("roles")
export class RolePermissionsController {
  constructor(
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  @Get(":id/permissions")
  @ApiOperation({
    summary: "Read bounded persisted role permission grant history",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiOkResponse({ schema: successEnvelope(rolePermissionPageSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(permissionProtectedError)
  @ApiForbiddenResponse(permissionProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  history(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<RolePermissionPage> {
    return this.permissions.listRolePermissions(id, page, pageSize);
  }

  @Post(":id/permissions")
  @ApiOperation({
    summary: "Grant one registered permission to an organization role",
    description:
      "The command stores scope metadata and optional expiry. It does not resolve resources or authorize application actions.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ schema: grantRolePermissionSchema })
  @ApiCreatedResponse({ schema: successEnvelope(rolePermissionSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(permissionProtectedError)
  @ApiForbiddenResponse(permissionProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  grant(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<RolePermissionView> {
    return this.permissions.grant(id, body);
  }

  @Post(":roleId/permissions/:permissionKey/remove")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Historically remove the effective role permission grant",
  })
  @ApiParam({ name: "roleId", format: "uuid" })
  @ApiParam({
    name: "permissionKey",
    schema: {
      type: "string",
      maxLength: 160,
      pattern: "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$",
    },
  })
  @ApiOkResponse({ schema: successEnvelope(rolePermissionSchema) })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(permissionProtectedError)
  @ApiForbiddenResponse(permissionProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  remove(
    @Param("roleId") roleId: string,
    @Param("permissionKey") permissionKey: string,
  ): Promise<RolePermissionView> {
    return this.permissions.remove(roleId, permissionKey);
  }
}
