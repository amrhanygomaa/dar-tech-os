import { Controller, Get } from '@nestjs/common';
import type { FoundationDescriptor } from '@dar-tech/types';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  describe(): { data: FoundationDescriptor } {
    return { data: this.appService.describe() };
  }
}
