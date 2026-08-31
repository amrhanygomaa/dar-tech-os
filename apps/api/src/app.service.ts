import { Injectable } from '@nestjs/common';
import type { FoundationDescriptor } from '@dar-tech/types';

@Injectable()
export class AppService {
  describe(): FoundationDescriptor {
    return {
      name: 'dar-tech-os',
      runtime: 'api',
      apiVersion: 'v1',
    };
  }
}
