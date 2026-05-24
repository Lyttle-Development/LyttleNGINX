import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTHORIZATION_POLICY_KEY } from '../decorators/authorize.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { AuthorizationRule } from '../types/authorization-policy';
import { resolveEffectiveRoles } from '../types/auth-role';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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
    const identity = request.auth;

    if (!identity) {
      throw new ForbiddenException('Authenticated identity is required');
    }

    const effectiveRoles = new Set(resolveEffectiveRoles(identity));
    const allowed = policy.some((rule) => this.matchesRule(rule, identity, effectiveRoles));

    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions for this endpoint');
    }

    return true;
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

