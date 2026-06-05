import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTHORIZATION_POLICY_KEY } from '../decorators/authorize.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthorizationRule } from '../types/authorization-policy';
import { resolveEffectiveRoles } from '../types/auth-role';
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
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<AuthorizationRule[]>(
      AUTHORIZATION_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy || policy.length === 0) {
      throw new ForbiddenException(
        'No authorization policy is configured for this endpoint',
      );
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse();
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions>(
      AUDIT_OPTIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const identity = request.auth;

    if (!identity) {
      const error = new ForbiddenException(
        'Authenticated identity is required',
      );
      this.recordDeniedAttempt(request, response, auditOptions, error);
      throw error;
    }

    const effectiveRoles = new Set(resolveEffectiveRoles(identity));
    const allowed = policy.some((rule) =>
      this.matchesRule(rule, identity, effectiveRoles),
    );

    if (!allowed) {
      const error = new ForbiddenException(
        'Insufficient permissions for this endpoint',
      );
      this.recordDeniedAttempt(request, response, auditOptions, error);
      throw error;
    }

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
      responseStatus: 403,
      target: resolveAuditTarget(request, auditOptions),
    });
  }

  private matchesRule(
    rule: AuthorizationRule,
    identity: NonNullable<AuthenticatedRequest['auth']>,
    effectiveRoles: ReadonlySet<string>,
  ): boolean {
    const actorTypesAllowed =
      !rule.actorTypes || rule.actorTypes.includes(identity.actorType);
    const rolesAllowed =
      !rule.roles || rule.roles.some((role) => effectiveRoles.has(role));

    return actorTypesAllowed && rolesAllowed;
  }
}
