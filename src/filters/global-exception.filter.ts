import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { CertificateError } from '../certificate/errors/certificate.errors';
import { LogsService } from '../logs/logs.service';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logsService: LogsService;

  constructor(logsService: LogsService) {
    this.logsService = logsService;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_SERVER_ERROR';
    let details: any = undefined;

    if (exception instanceof CertificateError) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse() as any;
      message = errorResponse.message;
      code = errorResponse.code;
      details = errorResponse.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === 'string'
          ? errorResponse
          : (errorResponse as any).message || message;
    } else if (exception instanceof Error) {
      message = exception.message;
      details = { stack: exception.stack };
    }

    this.logsService.error(
      {
        message: `${request.method ?? 'UNKNOWN'} ${request.url ?? '/'} failed with HTTP ${status}`,
        event: 'http.request.error',
        statusCode: status,
        errorCode: code,
        details,
      },
      exception instanceof Error ? exception.stack : undefined,
      GlobalExceptionFilter.name,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      code,
      ...(details && { details }),
    });
  }
}
