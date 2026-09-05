export const APPROVAL_EVENTS = {
  requested: {
    name: "ApprovalRequested.v1",
    eventType: "identity.approval-requested",
    eventVersion: 1,
  },
  stepApproved: {
    name: "ApprovalStepApproved.v1",
    eventType: "identity.approval-step-approved",
    eventVersion: 1,
  },
  rejected: {
    name: "ApprovalRejected.v1",
    eventType: "identity.approval-rejected",
    eventVersion: 1,
  },
  completed: {
    name: "ApprovalCompleted.v1",
    eventType: "identity.approval-completed",
    eventVersion: 1,
  },
  executed: {
    name: "ApprovedActionExecuted.v1",
    eventType: "identity.approved-action-executed",
    eventVersion: 1,
  },
  executionFailed: {
    name: "ApprovedActionExecutionFailed.v1",
    eventType: "identity.approved-action-execution-failed",
    eventVersion: 1,
  },
} as const;
