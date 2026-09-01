import { type DynamicModule, Module, type OnModuleDestroy } from '@nestjs/common';
import type { DatabaseClientOptions } from './client.js';
import { createPrismaClient } from './client.js';

export const DATABASE_CLIENT = Symbol('DATABASE_CLIENT');

export class DatabaseLifecycle implements OnModuleDestroy {
  constructor(private readonly client: ReturnType<typeof createPrismaClient>) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

@Module({})
export class DatabaseModule {
  static register(options: DatabaseClientOptions): DynamicModule {
    const client = createPrismaClient(options);
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_CLIENT, useValue: client },
        { provide: DatabaseLifecycle, useValue: new DatabaseLifecycle(client) },
      ],
      exports: [DATABASE_CLIENT],
    };
  }
}
