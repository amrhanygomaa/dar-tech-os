import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from '../sessions/session.contracts.js';

export function configureOpenApi(app: INestApplication): void {
  const configuration = new DocumentBuilder()
    .setTitle('Dar Tech OS API')
    .setDescription(
      'Internal Dar Tech OS API. Invitation-only onboarding and linked-account authentication establish opaque server-side browser sessions through host-only HttpOnly cookies. Raw session credentials are never returned in JSON, and bearer or refresh tokens are not supported. Protected application actions are centrally authorized from the current session, effective organization roles, canonical permission grants, and matching resource scope. Audit and security history is append-only.',
    )
    .setVersion('1.0.0')
    .addCookieAuth(SESSION_COOKIE_NAME, {
      type: 'apiKey',
      in: 'cookie',
      name: SESSION_COOKIE_NAME,
      description: 'Opaque HttpOnly application-session credential. It is never returned in JSON.',
    })
    .build();
  const document = SwaggerModule.createDocument(app, configuration);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });
}
