import { API_ERROR_CODES } from '@dar-tech/types';
import { ApplicationError } from '@dar-tech/observability';

export function authenticationRequired(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authenticationRequired,
    401,
    'Trusted authentication is required',
  );
}

export function authorizationDenied(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authorizationDenied,
    403,
    'This action is not authorized',
  );
}

export function identityResourceNotFound(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.notFound, 404, 'Resource not found');
}

export function lifecycleMutationNotAllowed(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.identityLifecycleMutationNotAllowed,
    422,
    'Employee lifecycle can be changed only through an explicit lifecycle command',
  );
}

export function invalidIdentityUpdate(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.identityUpdateInvalid,
    422,
    'Employee profile update is invalid',
  );
}

export function invalidIdentityRequest(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invalidRequest,
    400,
    'Request could not be processed',
  );
}
