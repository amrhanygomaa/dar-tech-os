import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export function sessionAuthenticationRequired(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authenticationRequired,
    401,
    'Trusted authentication is required',
  );
}

export function sessionAuthorizationDenied(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authorizationDenied,
    403,
    'This action is not authorized',
  );
}

export function sessionNotFound(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.notFound, 404, 'Resource not found');
}

export function invalidSessionRequest(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.invalidRequest, 400, 'Request could not be processed');
}
