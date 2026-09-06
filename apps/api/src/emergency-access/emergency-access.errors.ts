import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export const emergencyAccessAuthenticationRequired = () => new ApplicationError(API_ERROR_CODES.authenticationRequired, 401, 'Authentication is required');
export const emergencyAccessDenied = () => new ApplicationError(API_ERROR_CODES.authorizationDenied, 403, 'Emergency access is not authorized');
export const emergencyAccessInvalid = () => new ApplicationError(API_ERROR_CODES.emergencyAccessInputInvalid, 422, 'Emergency access input is invalid');
export const emergencyAccessConflict = () => new ApplicationError(API_ERROR_CODES.emergencyAccessConflict, 409, 'Emergency access request conflicts with existing state');
export const emergencyAccessNotFound = () => new ApplicationError(API_ERROR_CODES.notFound, 404, 'Emergency access grant was not found');
export const emergencyAccessStepUpRequired = () => new ApplicationError(API_ERROR_CODES.stepUpRequired, 403, 'Fresh trusted step-up authentication is required');
