import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import {
  ensureAuditContext,
  getRequestIpAddress,
  getRequestPath,
} from './audit-context';
import {
  resolveAuditAction,
  resolveAuditError,
  resolveAuditOutcome,
  resolveAuditStatusCode,
  resolveAuditTarget,
} from './audit-record.utils';
import {
  AUDIT_OPTIONS_KEY,
  shouldAuditHttpRequest,
} from './decorators/audit.decorator';
import { AuditService } from './audit.service';
import { AuditOptions } from './types/audit.types';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions>(
      AUDIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic || !shouldAuditHttpRequest(request.method, auditOptions)) {
      return next.handle();
    }

    const auditContext = ensureAuditContext(request, response);
    const action = resolveAuditAction(request, auditOptions);

    return next.handle().pipe(
      tap((responseBody) => {
        const responseStatus = response.statusCode || 200;
        const outcome = resolveAuditOutcome(responseStatus);
        const { errorMessage } =
          outcome === 'success'
            ? {}
            : this.readManualFailureMessage(responseBody);

        void this.auditService.recordEvent({
          action,
          actor: request.auth,
          correlationId: auditContext.correlationId,
          errorMessage,
          ipAddress: getRequestIpAddress(request),
          outcome,
          requestMethod: request.method || 'UNKNOWN',
          requestPath: getRequestPath(request),
          responseStatus,
          target: resolveAuditTarget(request, auditOptions, responseBody),
        });
      }),
      catchError((error: unknown) => {
        const responseStatus = resolveAuditStatusCode(
          error,
          response.statusCode,
        );
        const { errorCode, errorMessage } = resolveAuditError(error);

        void this.auditService.recordEvent({
          action,
          actor: request.auth,
          correlationId: auditContext.correlationId,
          errorCode,
          errorMessage,
          ipAddress: getRequestIpAddress(request),
          outcome: resolveAuditOutcome(responseStatus),
          requestMethod: request.method || 'UNKNOWN',
          requestPath: getRequestPath(request),
          responseStatus,
          target: resolveAuditTarget(request, auditOptions),
        });

        return throwError(() => error);
      }),
    );
  }

  private readManualFailureMessage(responseBody: unknown) {
    if (typeof responseBody !== 'object' || responseBody === null) {
      return {};
    }

    const record = responseBody as Record<string, unknown>;
    if (typeof record['error'] === 'string' && record['error'].trim()) {
      return { errorMessage: record['error'].trim() };
    }

    if (typeof record['message'] === 'string' && record['message'].trim()) {
      return { errorMessage: record['message'].trim() };
    }

    return {};
  }
}
