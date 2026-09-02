import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export function invalidRoleRequest(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.invalidRequest, 400, 'Request could not be processed');
}

export function invalidRoleInput(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.roleInputInvalid, 422, 'Role input is invalid');
}

export function immutableRoleKey(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.roleKeyImmutable,
    422,
    'The stable role key cannot be changed',
  );
}

export function roleConflict(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.roleConflict,
    409,
    'A role with the same key or normalized name already exists',
  );
}

export function roleArchived(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.roleArchived,
    409,
    'An archived role cannot receive a new assignment',
  );
}

export function roleAssignmentConflict(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.roleAssignmentConflict,
    409,
    'The effective assignment has different expiry semantics',
  );
}

export function roleResourceNotFound(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.notFound, 404, 'Resource not found');
}
