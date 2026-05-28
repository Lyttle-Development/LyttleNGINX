import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHmac,
  createPublicKey,
  KeyObject,
  randomUUID,
  createHash,
  timingSafeEqual,
  verify,
} from 'crypto';
import {
  AuthCapabilities,
  AuthIdentity,
  ActorType,
  ConfiguredApiKeySummary,
} from './types/auth-identity';
import { AUTH_ROLES, AUTH_ROLE_HIERARCHY } from './types/auth-role';

@Injectable()
export class AuthService {
  private readonly validApiKeys: Map<string, AuthIdentity>;
  private readonly defaultAdminRoles: string[];
  private readonly defaultAdminScopes: string[];
  private readonly jwtIssuer?: string;
  private readonly jwtAudience?: string;
  private readonly jwtAllowedAlgorithms: string[];
  private readonly jwtSecret?: string;
  private readonly jwtPublicKey?: KeyObject;
  private readonly accessTokenTtlSeconds: number;

  constructor() {
    const apiKeys =
      process.env['API_KEY']
        ?.split(',')
        .map((apiKey) => apiKey.trim())
        .filter(Boolean) || [];
    this.defaultAdminRoles = this.parseDelimitedEnv(
      process.env['AUTH_DEFAULT_ADMIN_ROLES'],
      ['platform-admin'],
    );
    this.defaultAdminScopes = this.parseDelimitedEnv(
      process.env['AUTH_DEFAULT_ADMIN_SCOPES'],
      ['admin:full'],
    );
    this.jwtIssuer = process.env['AUTH_JWT_ISSUER']?.trim() || 'lyttle-nginx';
    this.jwtAudience =
      process.env['AUTH_JWT_AUDIENCE']?.trim() || 'lyttle-nginx-admin';
    this.jwtAllowedAlgorithms = this.parseDelimitedEnv(
      process.env['AUTH_JWT_ALLOWED_ALGS'],
      ['HS256', 'RS256'],
    );
    this.jwtSecret = process.env['AUTH_JWT_SECRET']?.trim() || undefined;
    this.jwtPublicKey = this.loadJwtPublicKey(
      process.env['AUTH_JWT_PUBLIC_KEY'],
    );
    this.accessTokenTtlSeconds = this.parsePositiveInteger(
      process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'],
      900,
    );
    this.validApiKeys = new Map(
      apiKeys.map((apiKey, index) => {
        const apiKeyId = this.buildApiKeyId(apiKey, index);
        const identity: AuthIdentity = {
          id: `api-key:${apiKeyId}`,
          subject: `api-key:${apiKeyId}`,
          actorType: 'admin',
          authMethod: 'api-key',
          displayName: `legacy-api-key-${index + 1}`,
          roles: [...this.defaultAdminRoles],
          scopes: [...this.defaultAdminScopes],
          audience: this.jwtAudience ? [this.jwtAudience] : [],
          issuer: this.jwtIssuer,
          apiKeyId,
        };

        return [apiKey, identity] as const;
      }),
    );
  }

  authenticateApiKey(apiKey: string): AuthIdentity | null {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey || this.validApiKeys.size === 0) {
      return null;
    }

    const provided = Buffer.from(normalizedApiKey);

    for (const [validApiKey, identity] of this.validApiKeys.entries()) {
      const candidate = Buffer.from(validApiKey);
      if (
        provided.length === candidate.length &&
        timingSafeEqual(provided, candidate)
      ) {
        return { ...identity };
      }
    }

    return null;
  }

  validateApiKey(apiKey: string): boolean {
    return this.authenticateApiKey(apiKey) !== null;
  }

  isAuthEnabled(): boolean {
    return this.validApiKeys.size > 0 || this.canVerifyBearerTokens();
  }

  getAuthCapabilities(): AuthCapabilities {
    const methods: Array<'api-key' | 'bearer-token'> = [];
    if (this.validApiKeys.size > 0) {
      methods.push('api-key');
    }
    if (this.canVerifyBearerTokens()) {
      methods.push('bearer-token');
    }

    return {
      authEnabled: this.isAuthEnabled(),
      methods,
      apiKeyConfigured: this.validApiKeys.size > 0,
      apiKeyCount: this.validApiKeys.size,
      bearerTokenVerificationConfigured: this.canVerifyBearerTokens(),
      tokenExchangeEnabled: this.canIssueAccessTokens(),
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
      supportedBearerAlgorithms: this.getSupportedBearerAlgorithms(),
      supportedRoles: [...AUTH_ROLES],
      roleHierarchy: { ...AUTH_ROLE_HIERARCHY },
      defaultAdminRoles: [...this.defaultAdminRoles],
      defaultAdminScopes: [...this.defaultAdminScopes],
    };
  }

  listConfiguredApiKeys(): ConfiguredApiKeySummary[] {
    return [...this.validApiKeys.entries()].map(([apiKey, identity]) => ({
      apiKeyId: identity.apiKeyId ?? this.buildApiKeyId(apiKey, 0),
      fingerprint: this.fingerprintApiKey(apiKey),
      displayName: identity.displayName,
      roles: [...identity.roles],
      scopes: [...identity.scopes],
    }));
  }

  fingerprintApiKey(apiKey: string): string {
    return createHash('sha256')
      .update(apiKey.trim())
      .digest('hex')
      .slice(0, 16);
  }

  canIssueAccessTokens(): boolean {
    return Boolean(this.jwtSecret);
  }

  canVerifyBearerTokens(): boolean {
    return Boolean(this.jwtSecret || this.jwtPublicKey);
  }

  issueAccessToken(identity: AuthIdentity) {
    if (!this.jwtSecret) {
      throw new ServiceUnavailableException(
        'JWT token issuance is not configured',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.accessTokenTtlSeconds;
    const payload = {
      sub: identity.subject,
      iss: this.jwtIssuer,
      aud: this.jwtAudience,
      iat: now,
      nbf: now,
      exp,
      jti: randomUUID(),
      name: identity.displayName,
      roles: identity.roles,
      scope: identity.scopes.join(' '),
      actor_type: identity.actorType,
      api_key_id: identity.apiKeyId,
      node_id: identity.nodeId,
    };

    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };
    const signingInput = `${this.base64UrlEncodeJson(header)}.${this.base64UrlEncodeJson(payload)}`;
    const signature = createHmac('sha256', this.jwtSecret)
      .update(signingInput)
      .digest('base64url');
    const accessToken = `${signingInput}.${signature}`;

    return {
      tokenType: 'Bearer',
      accessToken,
      expiresInSeconds: this.accessTokenTtlSeconds,
      expiresAt: new Date(exp * 1000).toISOString(),
      actor: {
        subject: identity.subject,
        actorType: identity.actorType,
        roles: identity.roles,
        scopes: identity.scopes,
      },
    };
  }

  authenticateBearerToken(token: string): AuthIdentity {
    if (!this.canVerifyBearerTokens()) {
      throw new UnauthorizedException(
        'Bearer token authentication is not configured',
      );
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      throw new UnauthorizedException('Malformed bearer token');
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const header = this.parseJsonSegment<Record<string, unknown>>(
      headerSegment,
      'Invalid bearer token header',
    );
    const payload = this.parseJsonSegment<Record<string, unknown>>(
      payloadSegment,
      'Invalid bearer token payload',
    );
    const algorithm = this.readStringClaim(header.alg);

    if (!algorithm || !this.jwtAllowedAlgorithms.includes(algorithm)) {
      throw new UnauthorizedException('Unsupported bearer token algorithm');
    }

    const signingInput = `${headerSegment}.${payloadSegment}`;
    this.verifyJwtSignature(algorithm, signingInput, signatureSegment);
    this.validateRegisteredClaims(payload);

    const subject =
      this.readStringClaim(payload['sub']) ||
      this.readStringClaim(payload['client_id']);
    if (!subject) {
      throw new UnauthorizedException('Bearer token subject is required');
    }

    const actorType = this.resolveActorType(payload);
    const audience = this.extractAudience(payload.aud);
    const roles = this.extractRoles(payload);
    const scopes = this.extractScopes(payload);

    return {
      id: `${actorType}:${subject}`,
      subject,
      actorType,
      authMethod: 'bearer-token',
      displayName:
        this.readStringClaim(payload['name']) ||
        this.readStringClaim(payload['preferred_username']) ||
        subject,
      roles,
      scopes,
      audience,
      issuer: this.readStringClaim(payload['iss']),
      tokenId: this.readStringClaim(payload['jti']),
      nodeId: this.readStringClaim(payload['node_id']),
      issuedAt: this.toIsoTimestamp(payload['iat']),
      expiresAt: this.toIsoTimestamp(payload['exp']),
      claims: payload,
    };
  }

  private parseDelimitedEnv(
    value: string | undefined,
    defaults: string[],
  ): string[] {
    const parsed =
      value
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    return parsed.length > 0 ? [...new Set(parsed)] : defaults;
  }

  private parsePositiveInteger(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private buildApiKeyId(apiKey: string, index: number): string {
    const digest = createHmac('sha256', 'lyttle-nginx-api-key-fingerprint')
      .update(apiKey)
      .digest('hex')
      .slice(0, 12);
    return `${index + 1}-${digest}`;
  }

  private loadJwtPublicKey(value: string | undefined): KeyObject | undefined {
    const normalized = value?.replace(/\\n/g, '\n').trim();
    if (!normalized) {
      return undefined;
    }

    try {
      return createPublicKey(normalized);
    } catch {
      return undefined;
    }
  }

  private getSupportedBearerAlgorithms(): string[] {
    const supported: string[] = [];
    if (this.jwtSecret && this.jwtAllowedAlgorithms.includes('HS256')) {
      supported.push('HS256');
    }
    if (this.jwtPublicKey && this.jwtAllowedAlgorithms.includes('RS256')) {
      supported.push('RS256');
    }
    return supported;
  }

  private verifyJwtSignature(
    algorithm: string,
    signingInput: string,
    signatureSegment: string,
  ) {
    const signature = this.base64UrlDecode(
      signatureSegment,
      'Invalid bearer token signature',
    );

    if (algorithm === 'HS256') {
      if (!this.jwtSecret) {
        throw new UnauthorizedException(
          'HS256 bearer token verification is unavailable',
        );
      }

      const expected = Buffer.from(
        createHmac('sha256', this.jwtSecret).update(signingInput).digest(),
      );
      if (
        expected.length !== signature.length ||
        !timingSafeEqual(expected, Buffer.from(signature))
      ) {
        throw new UnauthorizedException('Invalid bearer token signature');
      }
      return;
    }

    if (algorithm === 'RS256') {
      if (!this.jwtPublicKey) {
        throw new UnauthorizedException(
          'RS256 bearer token verification is unavailable',
        );
      }

      const valid = verify(
        'RSA-SHA256',
        Buffer.from(signingInput),
        this.jwtPublicKey,
        signature,
      );
      if (!valid) {
        throw new UnauthorizedException('Invalid bearer token signature');
      }
      return;
    }

    throw new UnauthorizedException('Unsupported bearer token algorithm');
  }

  private validateRegisteredClaims(payload: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = this.readNumericClaim(payload['exp']);
    if (expiresAt !== undefined && expiresAt <= now) {
      throw new UnauthorizedException('Bearer token has expired');
    }

    const notBefore = this.readNumericClaim(payload['nbf']);
    if (notBefore !== undefined && notBefore > now) {
      throw new UnauthorizedException('Bearer token is not active yet');
    }

    const issuer = this.readStringClaim(payload['iss']);
    if (this.jwtIssuer && issuer && issuer !== this.jwtIssuer) {
      throw new UnauthorizedException('Bearer token issuer is invalid');
    }

    const audience = this.extractAudience(payload['aud']);
    if (
      this.jwtAudience &&
      audience.length > 0 &&
      !audience.includes(this.jwtAudience)
    ) {
      throw new UnauthorizedException('Bearer token audience is invalid');
    }
  }

  private resolveActorType(payload: Record<string, unknown>): ActorType {
    const actorTypeClaim = this.readStringClaim(payload['actor_type']);
    if (actorTypeClaim === 'admin' || actorTypeClaim === 'internal-node') {
      return actorTypeClaim;
    }

    const scopes = this.extractScopes(payload);
    if (
      this.readStringClaim(payload['node_id']) ||
      scopes.includes('cluster:internal') ||
      scopes.includes('node:sync')
    ) {
      return 'internal-node';
    }

    return 'admin';
  }

  private extractRoles(payload: Record<string, unknown>): string[] {
    const roles = new Set<string>();

    for (const value of this.readStringArrayClaim(payload['roles'])) {
      roles.add(value);
    }

    for (const value of this.readStringArrayClaim(payload['role'])) {
      roles.add(value);
    }

    const realmAccess = this.readRecordClaim(payload['realm_access']);
    if (realmAccess) {
      for (const value of this.readStringArrayClaim(realmAccess['roles'])) {
        roles.add(value);
      }
    }

    return [...roles];
  }

  private extractScopes(payload: Record<string, unknown>): string[] {
    const scopes = new Set<string>();

    const scope = this.readStringClaim(payload['scope']);
    if (scope) {
      for (const value of scope
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)) {
        scopes.add(value);
      }
    }

    for (const value of this.readStringArrayClaim(payload['scp'])) {
      scopes.add(value);
    }

    for (const value of this.readStringArrayClaim(payload['permissions'])) {
      scopes.add(value);
    }

    return [...scopes];
  }

  private extractAudience(value: unknown): string[] {
    return this.readStringArrayClaim(value);
  }

  private readRecordClaim(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readStringClaim(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private readNumericClaim(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private readStringArrayClaim(value: unknown): string[] {
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }

    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
  }

  private parseJsonSegment<T>(segment: string, errorMessage: string): T {
    try {
      return JSON.parse(
        this.base64UrlDecode(segment, errorMessage).toString('utf8'),
      ) as T;
    } catch {
      throw new UnauthorizedException(errorMessage);
    }
  }

  private base64UrlEncodeJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private base64UrlDecode(value: string, errorMessage: string): Buffer {
    try {
      return Buffer.from(value, 'base64url');
    } catch {
      throw new UnauthorizedException(errorMessage);
    }
  }

  private toIsoTimestamp(value: unknown): string | undefined {
    const timestamp = this.readNumericClaim(value);
    return timestamp !== undefined
      ? new Date(timestamp * 1000).toISOString()
      : undefined;
  }
}
