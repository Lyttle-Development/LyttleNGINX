import { SetMetadata } from '@nestjs/common';
import { AuthorizationRule } from '../types/authorization-policy';
import { AuthRole } from '../types/auth-role';

export const AUTHORIZATION_POLICY_KEY = 'authorizationPolicy';

export const Authorize = (...rules: AuthorizationRule[]) =>
  SetMetadata(AUTHORIZATION_POLICY_KEY, rules);

export const AuthorizeAdmin = (...roles: AuthRole[]) =>
  Authorize({
    actorTypes: ['admin'],
    roles: roles.length > 0 ? roles : undefined,
  });

export const AuthorizeInternalNode = () =>
  Authorize({ actorTypes: ['internal-node'] });

export const AuthorizeInternalNodeOrAdmin = (...roles: AuthRole[]) =>
  Authorize(
    { actorTypes: ['internal-node'] },
    {
      actorTypes: ['admin'],
      roles: roles.length > 0 ? roles : undefined,
    },
  );

