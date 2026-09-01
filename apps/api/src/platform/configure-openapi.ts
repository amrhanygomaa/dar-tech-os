import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureOpenApi(app: INestApplication): void {
  const configuration = new DocumentBuilder()
    .setTitle('Dar Tech OS API')
    .setDescription(
      'Internal Dar Tech OS API. Identity endpoints deny until a trusted actor and authorization adapter are installed.',
    )
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, configuration);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });
}
