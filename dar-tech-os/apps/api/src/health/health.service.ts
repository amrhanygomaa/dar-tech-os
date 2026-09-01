import { Inject, Injectable } from '@nestjs/common';
import { API_ERROR_CODES } from '@dar-tech/types';
import { ApplicationError } from '@dar-tech/observability';
import {
  DATABASE_READINESS_PORT,
  type DatabaseReadinessPort,
} from './database-readiness.port.js';

export interface LivenessStatus {
  readonly status: 'ok';
}

export interface DependencyHealthStatus {
  readonly status: 'ok' | 'degraded';
  readonly checks: {
    readonly database: {
      readonly status: 'up' | 'down';
      readonly latencyMs: number;
    };
  };
}

export interface ReadinessStatus extends DependencyHealthStatus {
  readonly status: 'ok';
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_READINESS_PORT)
    private readonly databaseReadiness: DatabaseReadinessPort,
  ) {}

  liveness(): LivenessStatus {
    return { status: 'ok' };
  }

  async health(): Promise<DependencyHealthStatus> {
    const database = await this.databaseReadiness.check();
    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      checks: { database },
    };
  }

  async readiness(): Promise<ReadinessStatus> {
    const health = await this.health();
    if (health.checks.database.status !== 'up') {
      throw new ApplicationError(
        API_ERROR_CODES.serviceUnavailable,
        503,
        'Service is not ready',
      );
    }

    return { ...health, status: 'ok' };
  }
}
