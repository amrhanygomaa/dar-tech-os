import { ApplicationError } from "@dar-tech/observability";
import { API_ERROR_CODES } from "@dar-tech/types";

export const approvalAuthenticationRequired = () =>
  new ApplicationError(
    API_ERROR_CODES.authenticationRequired,
    401,
    "Authentication is required",
  );
export const approvalDenied = (reason?: string) =>
  reason === "STEP_UP_REQUIRED"
    ? new ApplicationError(
        API_ERROR_CODES.stepUpRequired,
        403,
        "Stronger authentication is required. No decision was recorded.",
      )
    : new ApplicationError(
        API_ERROR_CODES.authorizationDenied,
        403,
        "The action is not authorized",
      );
export const approvalNotFound = () =>
  new ApplicationError(API_ERROR_CODES.notFound, 404, "Resource not found");
export const approvalConflict = () =>
  new ApplicationError(
    API_ERROR_CODES.approvalStateConflict,
    409,
    "Approval state changed; reload and retry",
  );
export const approvalPolicyUnavailable = () =>
  new ApplicationError(
    API_ERROR_CODES.serviceUnavailable,
    503,
    "Approval policy is temporarily unavailable",
  );
