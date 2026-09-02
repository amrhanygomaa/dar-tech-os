import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export function eventHistoryAuthenticationRequired(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authenticationRequired,
    401,
    'Trusted authentication is required',
  );
}

export function eventHistoryAuthorizationDenied(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authorizationDenied,
    403,
    'This action is not authorized',
  );
}

export function eventHistoryNotFound(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.notFound, 404, 'Resource not found');
}
