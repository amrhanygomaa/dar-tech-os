import { Module } from '@nestjs/common';
import { ApiFallbackController } from './api-fallback.controller.js';

@Module({ controllers: [ApiFallbackController] })
export class ApiFallbackModule {}
