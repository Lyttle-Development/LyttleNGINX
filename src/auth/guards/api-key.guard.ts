import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import {
  ensureAuditContext,
  getRequestIpAddress,
  getRequestPath,
} from '../../audit/audit-context';
import {
  resolveAuditAction,
  resolveAuditError,
  resolveAuditTarget,
} from '../../audit/audit-record.utils';
import {
  AUDIT_OPTIONS_KEY,
  shouldAuditHttpRequest,
} from '../../audit/decorators/audit.decorator';
import { AuditService } from '../../audit/audit.service';
import { AuditOptions } from '../../audit/types/audit.types';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly authService: AuthService;
  private readonly reflector: Reflector;
  private readonly auditService?: AuditService;

  constructor(
    authService: AuthService,
    reflector: Reflector,
    @Optional() auditService?: AuditService,
  ) {
    this.authService = authService;
    this.reflector = reflector;
    this.auditService = auditService;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse();
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions>(
      AUDIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const bearerToken = this.extractBearerToken(request.headers);

    if (bearerToken) {
      try {
        const identity = this.authService.authenticateBearerToken(bearerToken);
        request.auth = identity;
        request.user = identity;
        return true;
      } catch (error) {
        this.recordDeniedAttempt(request, response, auditOptions, error);
        throw error;
      }
    }

    const apiKey = this.extractApiKey(request.headers);
    if (!apiKey) {
      const error = new UnauthorizedException(
        'Authentication credentials are required',
      );
      this.recordDeniedAttempt(request, response, auditOptions, error);
      throw error;
    }

    const identity = this.authService.authenticateApiKey(apiKey);
    if (!identity) {
      const error = new UnauthorizedException('Invalid API key');
      this.recordDeniedAttempt(request, response, auditOptions, error);
      throw error;
    }

    request.auth = identity;
    request.user = identity;

    return true;
  }

  private recordDeniedAttempt(
    request: AuthenticatedRequest,
    response: { setHeader?: (name: string, value: string) => void },
    auditOptions?: AuditOptions,
    error?: unknown,
  ) {
    if (
      !this.auditService ||
      !shouldAuditHttpRequest(request.method, auditOptions)
    ) {
      return;
    }

    const auditContext = ensureAuditContext(request, response);
    const { errorCode, errorMessage } = resolveAuditError(error);

    void this.auditService.recordEvent({
      action: resolveAuditAction(request, auditOptions),
      actor: request.auth,
      correlationId: auditContext.correlationId,
      errorCode,
      errorMessage,
      ipAddress: getRequestIpAddress(request),
      outcome: 'denied',
      requestMethod: request.method || 'UNKNOWN',
      requestPath: getRequestPath(request),
      responseStatus: 401,
      target: resolveAuditTarget(request, auditOptions),
    });
  }

  private extractBearerToken(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const authorization = headers['authorization'];
    if (typeof authorization !== 'string') {
      return undefined;
    }

    const [scheme, ...credentials] = authorization.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'bearer' || credentials.length === 0) {
      return undefined;
    }

    const token = credentials.join(' ').trim();
    return token || undefined;
  }

  private extractApiKey(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const headerApiKey = headers['x-api-key'];
    if (typeof headerApiKey === 'string' && headerApiKey.trim()) {
      return headerApiKey.trim();
    }

    const authorization = headers['authorization'];
    if (typeof authorization !== 'string') {
      return undefined;
    }

    const [scheme, ...credentials] = authorization.trim().split(/\s+/);
    if (scheme?.toLowerCase() !== 'apikey' || credentials.length === 0) {
      return undefined;
    }

    const apiKey = credentials.join(' ').trim();
    return apiKey || undefined;
  }
}
