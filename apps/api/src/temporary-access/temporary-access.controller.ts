import {
  Body,
  Controller,
  Get,
  Headers,
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
} from "@nestjs/swagger";
import { SESSION_COOKIE_NAME } from "../sessions/session.contracts.js";
import type {
  TemporaryAccessGrantView,
  TemporaryAccessPage,
} from "./temporary-access.contracts.js";
import {
  errorEnvelopeSchema,
  temporaryAccessCreateSchema,
  temporaryAccessPageSchema,
  temporaryAccessResponseSchema,
  temporaryAccessRevokeSchema,
} from "./temporary-access.openapi.js";
import { TemporaryAccessService } from "./temporary-access.service.js";

@ApiTags("Temporary access")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller()
export class TemporaryAccessController {
  constructor(
    @Inject(TemporaryAccessService)
    private readonly temporaryAccess: TemporaryAccessService,
  ) {}

  @Get("temporary-access")
  @ApiOperation({ summary: "List organization-scoped temporary access grants" })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "REVOKED", "EXPIRED"],
  })
  @ApiQuery({
    name: "recipientEmployeeId",
    required: false,
    type: String,
    format: "uuid",
  })
  @ApiOkResponse({ schema: temporaryAccessPageSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
    @Query("recipientEmployeeId") recipientEmployeeId?: string,
  ): Promise<TemporaryAccessPage> {
    return this.temporaryAccess.list(
      page,
      pageSize,
      status,
      recipientEmployeeId,
    );
  }

  @Post("employees/:id/temporary-access")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Request or create one exact time-bounded temporary access grant",
  })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Opaque duplicate-suppression material; hashed before persistence.",
  })
  @ApiBody({ schema: temporaryAccessCreateSchema })
  @ApiOkResponse({ schema: temporaryAccessResponseSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  create(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TemporaryAccessGrantView> {
    return this.temporaryAccess.create(id, body, idempotencyKey);
  }

  @Get("temporary-access/:id")
  @ApiOperation({ summary: "Read one authorized temporary access grant" })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @ApiOkResponse({ schema: temporaryAccessResponseSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  detail(@Param("id") id: string): Promise<TemporaryAccessGrantView> {
    return this.temporaryAccess.detail(id);
  }

  @Post("temporary-access/:id/revoke")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Immediately and idempotently revoke one temporary access grant",
  })
  @ApiParam({ name: "id", type: String, format: "uuid" })
  @ApiOkResponse({ schema: temporaryAccessRevokeSchema })
  @ApiUnauthorizedResponse({ schema: errorEnvelopeSchema })
  @ApiForbiddenResponse({ schema: errorEnvelopeSchema })
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  revoke(@Param("id") id: string) {
    return this.temporaryAccess.revoke(id);
  }
}
