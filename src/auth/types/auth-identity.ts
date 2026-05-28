import { AuthRole } from './auth-role';

export type AuthMethod = 'api-key' | 'bearer-token';

export type ActorType = 'admin' | 'internal-node';

export interface AuthIdentity {
  id: string;
  subject: string;
  actorType: ActorType;
  authMethod: AuthMethod;
  displayName: string;
  roles: string[];
  scopes: string[];
  audience: string[];
  issuer?: string;
  tokenId?: string;
  apiKeyId?: string;
  nodeId?: string;
  issuedAt?: string;
  expiresAt?: string;
  claims?: Record<string, unknown>;
}

export interface ConfiguredApiKeySummary {
  apiKeyId: string;
  fingerprint: string;
  displayName: string;
  roles: string[];
  scopes: string[];
}

export interface AuthCapabilities {
  authEnabled: boolean;
  methods: AuthMethod[];
  apiKeyConfigured: boolean;
  apiKeyCount: number;
  bearerTokenVerificationConfigured: boolean;
  tokenExchangeEnabled: boolean;
  issuer?: string;
  audience?: string;
  supportedBearerAlgorithms: string[];
  supportedRoles: AuthRole[];
  roleHierarchy: Record<AuthRole, AuthRole[]>;
  defaultAdminRoles: string[];
  defaultAdminScopes: string[];
}
