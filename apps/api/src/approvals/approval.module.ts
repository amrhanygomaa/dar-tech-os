import {
  type DynamicModule,
  Global,
  Module,
  type Provider,
} from "@nestjs/common";
import type { AppEnvironment } from "@dar-tech/config";
import {
  APPROVAL_APPROVER_RESOLVER,
  APPROVAL_EXECUTION_LIFECYCLE_PORT,
  APPROVAL_REFERENCE_EVIDENCE_REPOSITORY,
  APPROVAL_REPOSITORY_PORT,
  type ApprovalApproverResolver,
} from "./approval.contracts.js";
import { ApprovalController } from "./approval.controller.js";
import { ApprovalMetrics } from "./approval-metrics.js";
import { DenyAllApprovalApproverResolver } from "./approval-policy.js";
import { ApprovalService } from "./approval.service.js";
import { PrismaApprovalRepository } from "./prisma-approval.repository.js";

@Global()
@Module({})
export class ApprovalModule {
  static register(
    environment: AppEnvironment,
    approverResolver?: ApprovalApproverResolver,
  ): DynamicModule {
    if (approverResolver && environment !== "test")
      throw new Error(
        "Approval test adapters are available only in the test environment",
      );
    const resolverProvider: Provider = approverResolver
      ? { provide: APPROVAL_APPROVER_RESOLVER, useValue: approverResolver }
      : {
          provide: APPROVAL_APPROVER_RESOLVER,
          useExisting: DenyAllApprovalApproverResolver,
        };
    return {
      module: ApprovalModule,
      global: true,
      controllers: [ApprovalController],
      providers: [
        DenyAllApprovalApproverResolver,
        resolverProvider,
        PrismaApprovalRepository,
        {
          provide: APPROVAL_REPOSITORY_PORT,
          useExisting: PrismaApprovalRepository,
        },
        {
          provide: APPROVAL_REFERENCE_EVIDENCE_REPOSITORY,
          useExisting: PrismaApprovalRepository,
        },
        ApprovalMetrics,
        ApprovalService,
        {
          provide: APPROVAL_EXECUTION_LIFECYCLE_PORT,
          useExisting: ApprovalService,
        },
      ],
      exports: [
        APPROVAL_REPOSITORY_PORT,
        APPROVAL_REFERENCE_EVIDENCE_REPOSITORY,
        APPROVAL_EXECUTION_LIFECYCLE_PORT,
        ApprovalService,
      ],
    };
  }
}
