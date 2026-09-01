import type { SchemaObject } from '@nestjs/swagger';
import { errorEnvelopeSchema, successEnvelope } from '../identity/identity.openapi.js';

export { errorEnvelopeSchema };

export const providerListSchema: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    required: ['key', 'displayName', 'iconKey', 'capabilities'],
    properties: {
      key: { type: 'string' },
      displayName: { type: 'string' },
      iconKey: { type: 'string', nullable: true },
      capabilities: {
        type: 'object',
        required: ['authentication', 'providerLogout'],
        properties: {
          authentication: { type: 'boolean', enum: [true] },
          providerLogout: { type: 'boolean' },
        },
      },
    },
  },
};

export const authenticationStartBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['redirectUri'],
  properties: {
    redirectUri: { type: 'string', format: 'uri' },
    loginHint: {
      type: 'string',
      maxLength: 160,
      description: 'Optional provider hint. It is never treated as an account identifier by Dar Tech.',
    },
  },
};

export const authenticationStartResponseSchema = successEnvelope({
  type: 'object',
  required: ['providerKey', 'interaction', 'authorizationUrl', 'expiresAt', 'sessionCreated'],
  properties: {
    providerKey: { type: 'string' },
    interaction: { type: 'string', enum: ['redirect'] },
    authorizationUrl: { type: 'string', format: 'uri' },
    expiresAt: { type: 'string', format: 'date-time' },
    sessionCreated: {
      type: 'boolean',
      enum: [false],
      description: 'S02-T03 verifies provider authentication but does not create an application session.',
    },
  },
});

export const authenticationCallbackBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionId', 'state'],
  properties: {
    transactionId: { type: 'string', format: 'uuid', writeOnly: true },
    state: { type: 'string', minLength: 16, maxLength: 512, writeOnly: true },
    nonce: { type: 'string', minLength: 16, maxLength: 512, writeOnly: true },
    code: { type: 'string', maxLength: 4096, writeOnly: true },
    error: { type: 'string', maxLength: 128, writeOnly: true },
  },
};

export const authenticationCallbackResponseSchema = successEnvelope({
  type: 'object',
  required: ['status', 'providerKey', 'sessionCreated', 'nextStep'],
  properties: {
    status: { type: 'string', enum: ['VERIFIED'] },
    providerKey: { type: 'string' },
    sessionCreated: {
      type: 'boolean',
      enum: [false],
      description: 'No cookie, bearer token, refresh token, or Session record is issued by S02-T03.',
    },
    nextStep: { type: 'string', enum: ['SESSION_ISSUANCE_DEFERRED'] },
  },
});

export const providerLogoutBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    postLogoutRedirectUri: { type: 'string', format: 'uri' },
  },
};

export const providerLogoutResponseSchema = successEnvelope({
  type: 'object',
  required: [
    'providerKey',
    'providerLogoutSupported',
    'logoutUrl',
    'applicationSessionRevoked',
  ],
  properties: {
    providerKey: { type: 'string' },
    providerLogoutSupported: { type: 'boolean' },
    logoutUrl: { type: 'string', format: 'uri', nullable: true },
    applicationSessionRevoked: {
      type: 'boolean',
      enum: [false],
      description: 'Provider logout is distinct from Dar Tech session revocation, which belongs to S02-T04.',
    },
  },
});
