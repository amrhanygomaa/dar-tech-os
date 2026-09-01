import { API_ERROR_CODES } from '@dar-tech/types';
import { ApplicationError } from '@dar-tech/observability';
import type { AuthenticationFailureCategory } from './auth.contracts.js';

export class ProviderAuthenticationError extends Error {
  constructor(readonly category: AuthenticationFailureCategory) {
    super('Provider authentication failed');
    this.name = 'ProviderAuthenticationError';
  }
}

export function authenticationFailed(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.authenticationFailed,
    401,
    'Authentication could not be completed',
  );
}

export function invalidAuthenticationRequest(): ApplicationError {
  return new ApplicationError(
    API_ERROR_CODES.invalidRequest,
    400,
    'Request could not be processed',
  );
}
