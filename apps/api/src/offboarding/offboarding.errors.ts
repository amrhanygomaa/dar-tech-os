import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export const lifecycleAuthenticationRequired = () => new ApplicationError(
  API_ERROR_CODES.authenticationRequired,
  401,
  'Authentication is required',
);
export const lifecycleDenied = () => new ApplicationError(
  API_ERROR_CODES.authorizationDenied,
  403,
  'Employee lifecycle command is not authorized',
);
export const lifecycleInvalid = () => new ApplicationError(
  API_ERROR_CODES.employeeLifecycleInputInvalid,
  422,
  'Employee lifecycle command input is invalid',
);
export const lifecycleConflict = () => new ApplicationError(
  API_ERROR_CODES.employeeLifecycleConflict,
  409,
  'Employee lifecycle transition conflicts with current state',
);
export const lifecycleNotFound = () => new ApplicationError(
  API_ERROR_CODES.notFound,
  404,
  'Employee was not found',
);
export const lifecycleStepUpRequired = () => new ApplicationError(
  API_ERROR_CODES.stepUpRequired,
  403,
  'Stronger authentication is required',
);
