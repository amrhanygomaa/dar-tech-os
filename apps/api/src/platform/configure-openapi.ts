import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOpenApi(app: INestApplication): void {
  const configuration = new DocumentBuilder()
    .setTitle('Dar Tech OS API')
    .setDescription(
      'Internal Dar Tech OS API. Invitation-only onboarding binds a one-time fragment secret to provider-neutral verified identity without creating a Dar Tech application session, cookie, bearer token, or refresh token. Roles and historical permission grants are organization-scoped data. The code-owned permission registry is product-global; T06 stores effective grant descriptors but does not authorize application actions. Audit and security history is append-only.',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, configuration);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });
}
