import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { API_ERROR_CODES, type ApiErrorCode, type ApiErrorResponse } from '@dar-tech/types';
import {
  ApplicationError,
  createRequestIdentifiers,
  type RequestContextStore,
  type StructuredLogger,
} from '@dar-tech/observability';

interface SafeErrorDescription {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly message: string;
}

function describeError(error: unknown): SafeErrorDescription {
  if (error instanceof ApplicationError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.safeMessage,
    };
  }

  if (error instanceof HttpException) {
    const statusCode = error.getStatus();
    if (statusCode === HttpStatus.NOT_FOUND) {
      return {
        statusCode,
        code: API_ERROR_CODES.notFound,
        message: 'Resource not found',
      };
    }

    if (statusCode >= 400 && statusCode < 500) {
      return {
        statusCode,
        code: API_ERROR_CODES.invalidRequest,
        message: 'Request could not be processed',
      };
    }

    if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
      return {
        statusCode,
        code: API_ERROR_CODES.serviceUnavailable,
        message: 'Service is temporarily unavailable',
      };
    }
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: API_ERROR_CODES.internalError,
    message: 'An unexpected error occurred',
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly contextStore: RequestContextStore,
    private readonly logger: StructuredLogger,
  ) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const description = describeError(error);
    const activeContext = this.contextStore.get();
    const fallbackIdentifiers = activeContext?.requestId
      ? undefined
      : createRequestIdentifiers(undefined, undefined);
    const requestId = activeContext?.requestId ?? fallbackIdentifiers!.requestId;
    if (fallbackIdentifiers) {
      response.setHeader('X-Request-ID', fallbackIdentifiers.requestId);
      response.setHeader('X-Correlation-ID', fallbackIdentifiers.correlationId);
    }
    const body: ApiErrorResponse = {
      error: {
        code: description.code,
        message: description.message,
        requestId,
      },
    };

    this.logger.errorEvent('http.request.failed', {
      code: description.code,
      statusCode: description.statusCode,
      errorCategory:
        error instanceof ApplicationError
          ? 'application'
          : error instanceof HttpException
            ? 'http'
            : 'unknown',
    });
    response.status(description.statusCode).json(body);
  }
}
