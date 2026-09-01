import { Controller, Get, Inject } from '@nestjs/common';
import type { FoundationDescriptor } from '@dar-tech/types';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  describe(): FoundationDescriptor {
    return this.appService.describe();
  }
}
