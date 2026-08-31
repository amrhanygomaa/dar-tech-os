import { DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@dar-tech/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

export const API_CONFIG = Symbol('API_CONFIG');

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AppController],
      providers: [AppService, { provide: API_CONFIG, useValue: config }],
    };
  }
}
