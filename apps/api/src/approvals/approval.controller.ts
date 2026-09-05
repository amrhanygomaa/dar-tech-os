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
  ApiCookieAuth,
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
import { SESSION_COOKIE_NAME } from "../sessions/session.contracts.js";
import type {
  ApprovalPage,
  ApprovalRequestView,
} from "./approval.contracts.js";
import { ApprovalService } from "./approval.service.js";
import {
  approvalDecisionSchema,
  approvalProtectedError,
  approvalSchema,
  errorEnvelopeSchema,
  successEnvelope,
} from "./approval.openapi.js";

@ApiTags("Approvals")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller("approvals")
export class ApprovalController {
  constructor(
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the organization-scoped approval inbox" })
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
    enum: [
      "PENDING",
      "IN_REVIEW",
      "APPROVED",
      "REJECTED",
      "EXECUTED",
      "FAILED",
    ],
  })
  @ApiQuery({
    name: "risk",
    required: false,
    enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  })
  @ApiOkResponse({
    schema: successEnvelope({
      type: "object",
      required: ["items", "page", "pageSize", "total"],
      properties: {
        items: { type: "array", items: approvalSchema },
        page: { type: "integer" },
        pageSize: { type: "integer" },
        total: { type: "integer" },
      },
    }),
  })
  @ApiBadRequestResponse({ schema: errorEnvelopeSchema })
  @ApiUnauthorizedResponse(approvalProtectedError)
  @ApiForbiddenResponse(approvalProtectedError)
  list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string,
    @Query("risk") risk?: string,
  ): Promise<ApprovalPage> {
    return this.approvals.list(page, pageSize, status, risk);
  }

  @Get(":id")
  @ApiOperation({
    summary:
      "Read one authorized approval request without cross-organization enumeration",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ schema: successEnvelope(approvalSchema) })
  @ApiUnauthorizedResponse(approvalProtectedError)
  @ApiForbiddenResponse(approvalProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  detail(@Param("id") id: string): Promise<ApprovalRequestView> {
    return this.approvals.detail(id);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Approve one currently eligible step after current subject resolution",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ schema: approvalDecisionSchema })
  @ApiOkResponse({ schema: successEnvelope(approvalSchema) })
  @ApiUnauthorizedResponse(approvalProtectedError)
  @ApiForbiddenResponse(approvalProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  approve(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ApprovalRequestView> {
    return this.approvals.approve(id, body);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Reject one currently eligible step after current subject resolution",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({ schema: approvalDecisionSchema })
  @ApiOkResponse({ schema: successEnvelope(approvalSchema) })
  @ApiUnauthorizedResponse(approvalProtectedError)
  @ApiForbiddenResponse(approvalProtectedError)
  @ApiNotFoundResponse({ schema: errorEnvelopeSchema })
  @ApiConflictResponse({ schema: errorEnvelopeSchema })
  @ApiUnprocessableEntityResponse({ schema: errorEnvelopeSchema })
  reject(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ApprovalRequestView> {
    return this.approvals.reject(id, body);
  }
}
