import { ApplicationError } from "@dar-tech/observability";
import { API_ERROR_CODES } from "@dar-tech/types";

export const temporaryAccessAuthenticationRequired = () =>
  new ApplicationError(
    API_ERROR_CODES.authenticationRequired,
    401,
    "Authentication is required",
  );
export const temporaryAccessDenied = () =>
  new ApplicationError(
    API_ERROR_CODES.authorizationDenied,
    403,
    "Temporary access is not authorized",
  );
export const temporaryAccessInvalid = () =>
  new ApplicationError(
    API_ERROR_CODES.temporaryAccessInputInvalid,
    422,
    "Temporary access input is invalid",
  );
export const temporaryAccessConflict = () =>
  new ApplicationError(
    API_ERROR_CODES.temporaryAccessConflict,
    409,
    "Temporary access request conflicts with existing state",
  );
export const temporaryAccessNotFound = () =>
  new ApplicationError(
    API_ERROR_CODES.notFound,
    404,
    "Temporary access grant was not found",
  );
export const temporaryAccessStepUpRequired = () =>
  new ApplicationError(
    API_ERROR_CODES.stepUpRequired,
    403,
    "Stronger authentication is required",
  );
