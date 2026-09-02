export type RuntimeName = 'api' | 'web' | 'worker';

export interface FoundationDescriptor {
  readonly name: 'dar-tech-os';
  readonly runtime: RuntimeName;
  readonly apiVersion: 'v1';
}

export const API_ERROR_CODES = {
  invalidRequest: 'INVALID_REQUEST',
  notFound: 'NOT_FOUND',
  serviceUnavailable: 'SERVICE_UNAVAILABLE',
  authenticationRequired: 'AUTHENTICATION_REQUIRED',
  authenticationFailed: 'AUTHENTICATION_FAILED',
  invitationInvalid: 'INVITATION_INVALID',
  invitationIssuanceConflict: 'INVITATION_ISSUANCE_CONFLICT',
  invitationStateConflict: 'INVITATION_STATE_CONFLICT',
  onboardingFailed: 'ONBOARDING_FAILED',
  rateLimitExceeded: 'RATE_LIMIT_EXCEEDED',
  authorizationDenied: 'AUTHORIZATION_DENIED',
  identityLifecycleMutationNotAllowed: 'IDENTITY_LIFECYCLE_MUTATION_NOT_ALLOWED',
  identityUpdateInvalid: 'IDENTITY_UPDATE_INVALID',
  internalError: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiResponseMeta {
  readonly requestId: string;
}

export interface ApiSuccessResponse<T> {
  readonly data: T;
  readonly meta: ApiResponseMeta;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}
