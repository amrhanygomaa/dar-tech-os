import { ApplicationError } from '@dar-tech/observability';
import { API_ERROR_CODES } from '@dar-tech/types';

export function invalidInvitationRequest(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invalidRequest,
    400,
    'Request could not be processed',
  );
}
export function invalidInvitationSecret(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invitationInvalid,
    401,
    'Invitation could not be validated',
  );
}

export function invitationIssuanceConflict(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invitationIssuanceConflict,
    409,
    'The employee invitation could not be issued',
  );
}

export function invitationStateConflict(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invitationStateConflict,
    409,
    'The invitation is not eligible for this action',
  );
}

export function invitationNotFound(): ApplicationError {
  return new ApplicationError(API_ERROR_CODES.notFound, 404, 'Resource not found');
}

export function onboardingFailed(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.onboardingFailed,
    401,
    'Onboarding could not be completed',
  );
}

export function rateLimitExceeded(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.rateLimitExceeded,
    429,
    'Request could not be processed',
  );
}
