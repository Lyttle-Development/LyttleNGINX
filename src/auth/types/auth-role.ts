import { AuthIdentity } from './auth-identity';

export const AUTH_ROLES = [
  'viewer',
  'operator',
  'security-admin',
  'platform-admin',
  'internal-node',
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export const AUTH_ROLE_HIERARCHY: Record<AuthRole, AuthRole[]> = {
  viewer: [],
  operator: ['viewer'],
  'security-admin': ['viewer'],
  'platform-admin': ['viewer', 'operator', 'security-admin'],
  'internal-node': [],
};

export function isAuthRole(value: string): value is AuthRole {
  return AUTH_ROLES.includes(value as AuthRole);
}

export function expandAuthRoles(roles: Iterable<string>): AuthRole[] {
  const expanded = new Set<AuthRole>();

  for (const role of roles) {
    if (!isAuthRole(role)) {
      continue;
    }

    expanded.add(role);

    for (const inheritedRole of AUTH_ROLE_HIERARCHY[role]) {
      expanded.add(inheritedRole);
    }
  }

  return [...expanded];
}

export function resolveEffectiveRoles(identity: AuthIdentity): AuthRole[] {
  const declaredRoles = new Set(identity.roles);

  if (identity.actorType === 'internal-node') {
    declaredRoles.add('internal-node');
  }

  return expandAuthRoles(declaredRoles);
}

