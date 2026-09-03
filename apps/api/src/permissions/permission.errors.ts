import { ApplicationError } from "@dar-tech/observability";
import { API_ERROR_CODES } from "@dar-tech/types";

export function invalidPermissionRequest(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invalidRequest,
    400,
    "Request could not be processed",
  );
}

export function invalidPermissionInput(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.permissionInputInvalid,
    422,
    "Permission grant input is invalid",
  );
}

export function permissionNotRegistered(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.permissionNotRegistered,
    422,
    "The permission key is not registered",
  );
}

export function permissionUnavailable(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.permissionUnavailable,
    409,
    "The registered permission is inactive, deprecated, or inconsistent",
  );
}

export function rolePermissionConflict(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.rolePermissionConflict,
    409,
    "The effective role permission has different scope, binding, or expiry semantics",
  );
}

export function permissionRoleArchived(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.roleArchived,
    409,
    "An archived role cannot receive a new permission grant",
  );
}

export function permissionResourceNotFound(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.notFound,
    404,
    "Resource not found",
  );
}

export class PermissionRegistryDriftError extends Error {
  constructor(
    message = "Permission registry drift requires explicit compatibility handling",
  ) {
    super(message);
    this.name = "PermissionRegistryDriftError";
  }
}
