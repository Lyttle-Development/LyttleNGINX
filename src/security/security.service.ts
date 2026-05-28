import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { AuthService } from '../auth/auth.service';
import {
  AuthIdentity,
  ConfiguredApiKeySummary,
} from '../auth/types/auth-identity';
import { resolveEffectiveRoles } from '../auth/types/auth-role';
import { PrivateKeyEncryptionService } from '../certificate/private-key-encryption.service';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';
import { RotateInternalCertsDto } from './dto/rotate-internal-certs.dto';
import { RotatePrivateKeyEncryptionDto } from './dto/rotate-private-key-encryption.dto';

@Injectable()
export class SecurityService {
  private readonly authService: AuthService;
  private readonly privateKeyEncryption: PrivateKeyEncryptionService;

  constructor(
    authService: AuthService,
    privateKeyEncryption: PrivateKeyEncryptionService,
  ) {
    this.authService = authService;
    this.privateKeyEncryption = privateKeyEncryption;
  }

  getSecurityStatus(identity: AuthIdentity) {
    const authCapabilities = this.authService.getAuthCapabilities();
    const configuredApiKeys = this.authService.listConfiguredApiKeys();
    const privateKeyProvider = this.privateKeyEncryption.getProviderStatus();
    const secrets = this.getSecretsHealth();
    const clusterProtocol =
      process.env['CLUSTER_CONTROL_PROTOCOL']?.trim().toLowerCase() || 'http';

    return {
      generatedAt: new Date().toISOString(),
      actor: this.presentIdentity(identity),
      auth: {
        ...authCapabilities,
        configuredApiKeys,
        legacyApiKeyBridgeEnabled:
          authCapabilities.apiKeyConfigured &&
          authCapabilities.tokenExchangeEnabled,
      },
      secrets,
      privateKeyEncryption: {
        ...privateKeyProvider,
        rotateEndpoint: '/security/rotate/private-key-encryption',
        providerReady: true,
      },
      backupProtection: {
        configured:
          Boolean(process.env['BACKUP_ENCRYPTION_KEY']?.trim()) ||
          process.env['NODE_ENV'] !== 'production',
        keyVersion:
          process.env['BACKUP_ENCRYPTION_KEY_VERSION']?.trim() || 'v1',
        usesDevelopmentFallback:
          !process.env['BACKUP_ENCRYPTION_KEY']?.trim() &&
          process.env['NODE_ENV'] !== 'production',
      },
      interNodeSecurity: {
        currentMode: 'authenticated-http',
        clusterControlProtocol: clusterProtocol,
        mtlsEnabled: false,
        internalNodeIdentityModel: 'jwt-or-api-key-bridge',
        rotateEndpoint: '/security/rotate/internal-certs',
        notes: [
          'Inter-node requests are authenticated but not yet mTLS-protected.',
          'The internal certificate rotation endpoint is a forward-compatible contract for future node PKI work.',
        ],
      },
      breakGlass: {
        rawCertificateExport: {
          endpoint: 'GET /certificates/backup/export/:id',
          requiredRole: 'platform-admin',
          audited: true,
        },
        apiKeyRotation: {
          endpoint: 'POST /security/rotate/api-key',
          requiredRole: 'platform-admin',
          hotReloadSupported: false,
          overlapRotationRecommended: authCapabilities.apiKeyConfigured,
        },
      },
    };
  }

  getSecurityPolicy() {
    return {
      generatedAt: new Date().toISOString(),
      roles: {
        viewer: {
          description:
            'Read-only visibility into cluster, certificate, and auth state.',
        },
        operator: {
          description:
            'Operational actions such as reloads, renewals, and upstream diagnostics.',
        },
        'security-admin': {
          description:
            'Security maintenance such as certificate/key lifecycle, encrypted backups, imports/restores, and security review APIs.',
        },
        'platform-admin': {
          description:
            'Full control-plane access including cluster leadership maintenance and break-glass flows.',
        },
        'internal-node': {
          description: 'Reserved for trusted inter-node control-plane traffic.',
        },
      },
      publicEndpoints: [
        'GET /health/live',
        'GET /health/startup',
        'GET /health/ready',
        'GET /metrics',
        'GET /metrics/json',
        'GET /.well-known/acme-challenge/:token',
      ],
      breakGlassFlows: [
        {
          endpoint: 'GET /certificates/backup/export/:id',
          requiredRole: 'platform-admin',
          notes:
            'Returns decrypted PEM material and must remain tightly controlled and audited.',
        },
      ],
      rotationFlows: [
        {
          endpoint: 'POST /security/rotate/api-key',
          requiredRole: 'platform-admin',
          behavior:
            'Validates a new API key candidate and returns a manual overlap rotation plan.',
        },
        {
          endpoint: 'POST /security/rotate/private-key-encryption',
          requiredRole: 'security-admin',
          behavior:
            'Re-encrypts stored certificate private keys with the currently configured provider/key version after operators rotate the master key outside the app.',
        },
        {
          endpoint: 'POST /security/rotate/internal-certs',
          requiredRole: 'platform-admin',
          behavior:
            'Reserves the future internal-mTLS certificate rotation contract and reports current prerequisites until node PKI is implemented.',
        },
      ],
      expectations: [
        'Secrets should be injected at runtime via Docker Swarm secrets or an external secret manager.',
        'API keys remain a temporary compatibility bridge; operators should prefer short-lived bearer tokens.',
        'Inter-node mTLS is not active yet, so the internal certificate rotation endpoint is currently a documented hook rather than a live PKI workflow.',
      ],
    };
  }

  getSecretsHealth() {
    const privateKeyProvider = this.privateKeyEncryption.getProviderStatus();
    const backupUsesDevelopmentFallback =
      !process.env['BACKUP_ENCRYPTION_KEY']?.trim() &&
      process.env['NODE_ENV'] !== 'production';
    const checks = [
      this.buildSecretCheck({
        name: 'API_KEY',
        configured: this.authService.getAuthCapabilities().apiKeyConfigured,
        requiredInProduction: true,
        details: {
          configuredKeyCount: this.authService.listConfiguredApiKeys().length,
        },
      }),
      this.buildSecretCheck({
        name: 'AUTH_JWT_SECRET_OR_PUBLIC_KEY',
        configured: this.authService.canVerifyBearerTokens(),
        requiredInProduction: false,
        details: {
          issuer: process.env['AUTH_JWT_ISSUER']?.trim() || 'lyttle-nginx',
          audience:
            process.env['AUTH_JWT_AUDIENCE']?.trim() || 'lyttle-nginx-admin',
          tokenExchangeEnabled: this.authService.canIssueAccessTokens(),
        },
      }),
      this.buildSecretCheck({
        name: 'PRIVATE_KEY_ENCRYPTION_MASTER_KEY',
        configured:
          Boolean(process.env['PRIVATE_KEY_ENCRYPTION_MASTER_KEY']?.trim()) ||
          process.env['NODE_ENV'] !== 'production',
        requiredInProduction: true,
        usingDevelopmentFallback: privateKeyProvider.usesDevelopmentFallback,
        details: {
          provider: privateKeyProvider.type,
          keyVersion: privateKeyProvider.keyVersion,
        },
      }),
      this.buildSecretCheck({
        name: 'BACKUP_ENCRYPTION_KEY',
        configured:
          Boolean(process.env['BACKUP_ENCRYPTION_KEY']?.trim()) ||
          process.env['NODE_ENV'] !== 'production',
        requiredInProduction: true,
        usingDevelopmentFallback: backupUsesDevelopmentFallback,
        details: {
          keyVersion:
            process.env['BACKUP_ENCRYPTION_KEY_VERSION']?.trim() || 'v1',
        },
      }),
      this.buildSecretCheck({
        name: 'ACME_ACCOUNT_PRIVATE_KEY_PATH',
        configured: Boolean(
          process.env['ACME_ACCOUNT_PRIVATE_KEY_PATH']?.trim(),
        ),
        requiredInProduction: true,
        details: {
          path: process.env['ACME_ACCOUNT_PRIVATE_KEY_PATH']?.trim() || null,
          existsOnDisk: this.safePathExists(
            process.env['ACME_ACCOUNT_PRIVATE_KEY_PATH']?.trim(),
          ),
        },
      }),
    ];

    const production = process.env['NODE_ENV'] === 'production';
    const blockingIssues = checks.filter(
      (check) => check.requiredInProduction && production && !check.configured,
    ).length;
    const warnings = checks.filter(
      (check) => check.usingDevelopmentFallback,
    ).length;

    return {
      generatedAt: new Date().toISOString(),
      status:
        blockingIssues > 0 ? 'unhealthy' : warnings > 0 ? 'degraded' : 'ok',
      summary: {
        total: checks.length,
        configured: checks.filter((check) => check.configured).length,
        blockingIssues,
        warnings,
        environment: process.env['NODE_ENV'] || 'development',
      },
      checks,
    };
  }

  getAccessReview(identity: AuthIdentity) {
    const effectiveRoles = resolveEffectiveRoles(identity);
    const accessibleCapabilities = {
      reviewSecurityStatus: this.hasAnyRole(effectiveRoles, ['security-admin']),
      reviewSecurityPolicy: this.hasAnyRole(effectiveRoles, ['security-admin']),
      reviewSecretsHealth: this.hasAnyRole(effectiveRoles, ['security-admin']),
      reviewAuditTrail: this.hasAnyRole(effectiveRoles, ['security-admin']),
      planApiKeyRotation: this.hasAnyRole(effectiveRoles, ['platform-admin']),
      rotatePrivateKeyEncryption: this.hasAnyRole(effectiveRoles, [
        'security-admin',
      ]),
      rotateInternalCerts: this.hasAnyRole(effectiveRoles, ['platform-admin']),
      useBreakGlassCertificateExport: this.hasAnyRole(effectiveRoles, [
        'platform-admin',
      ]),
    };

    return {
      generatedAt: new Date().toISOString(),
      actor: this.presentIdentity(identity),
      effectiveRoles,
      accessibleCapabilities,
      highRiskFlows: [
        {
          name: 'raw-certificate-export',
          endpoint: 'GET /certificates/backup/export/:id',
          allowed: accessibleCapabilities.useBreakGlassCertificateExport,
        },
        {
          name: 'api-key-rotation-plan',
          endpoint: 'POST /security/rotate/api-key',
          allowed: accessibleCapabilities.planApiKeyRotation,
        },
        {
          name: 'internal-cert-rotation-hook',
          endpoint: 'POST /security/rotate/internal-certs',
          allowed: accessibleCapabilities.rotateInternalCerts,
        },
      ],
      recommendations: [
        this.authService.getAuthCapabilities().apiKeyConfigured
          ? 'Prefer bearer tokens for routine automation and keep API keys only as a compatibility bridge.'
          : 'Legacy API keys are disabled; keep bearer-token verification available for admin clients.',
        accessibleCapabilities.rotatePrivateKeyEncryption
          ? 'After changing PRIVATE_KEY_ENCRYPTION_KEY_VERSION, run POST /security/rotate/private-key-encryption to re-encrypt stored key material.'
          : 'Use a security-admin or platform-admin identity when performing encryption-key maintenance.',
        'Treat decrypted certificate export as a break-glass action and review the audit trail after each use.',
      ],
      links: {
        status: '/security/status',
        policy: '/security/policy',
        secretsHealth: '/security/secrets/health',
        audit: '/audit',
      },
    };
  }

  planApiKeyRotation(identity: AuthIdentity, dto: RotateApiKeyDto) {
    const configuredApiKeys = this.authService.listConfiguredApiKeys();
    const retireTarget = dto.retireApiKeyId?.trim();
    const retireMatch = retireTarget
      ? (configuredApiKeys.find((entry) => entry.apiKeyId === retireTarget) ??
        null)
      : null;
    const candidate = this.validateApiKeyCandidate(
      dto.nextApiKey,
      configuredApiKeys,
    );

    return {
      generatedAt: new Date().toISOString(),
      requestedBy: this.presentIdentity(identity),
      status: candidate.valid ? 'ready' : 'rejected',
      strategy:
        configuredApiKeys.length > 0
          ? 'manual-overlap-env-rotation'
          : 'manual-bootstrap-env-rotation',
      current: {
        configuredKeyCount: configuredApiKeys.length,
        configuredApiKeys,
        retireTarget: retireTarget
          ? {
              requestedApiKeyId: retireTarget,
              found: Boolean(retireMatch),
              apiKey: retireMatch,
            }
          : null,
      },
      candidate,
      migrationBridge: this.buildBridgeToken(
        identity,
        dto.issueBridgeToken === true,
      ),
      recommendedSteps: [
        'Add the candidate API key to your secret store alongside the currently active API_KEY value(s).',
        'Redeploy or restart every node so the updated API_KEY set is loaded consistently across the cluster.',
        'Verify the new key against /auth/status and /security/status before retiring the old key.',
        'Prefer exchanging long-lived API-key automation for short-lived bearer tokens when AUTH_JWT_SECRET is configured.',
        retireTarget
          ? `After validation, remove the retired API key ${retireTarget} from the injected API_KEY list and redeploy again.`
          : 'After validation, remove any superseded API keys from the injected API_KEY list and redeploy again.',
      ],
      notes: [
        'The application does not hot-reload API keys today; rotation remains a secret-store plus redeploy workflow.',
        'This endpoint never persists or returns raw API key material. It only validates the candidate and returns a safe rotation plan.',
        dto.reason?.trim() ? `Operator reason: ${dto.reason.trim()}` : null,
      ].filter(Boolean),
    };
  }

  async rotatePrivateKeyEncryption(dto: RotatePrivateKeyEncryptionDto) {
    const provider = this.privateKeyEncryption.getProviderStatus();
    const confirmedVersion = dto.confirmKeyVersion.trim();

    if (confirmedVersion !== provider.keyVersion) {
      throw new BadRequestException(
        `confirmKeyVersion must match the active PRIVATE_KEY_ENCRYPTION_KEY_VERSION (${provider.keyVersion})`,
      );
    }

    if (dto.dryRun) {
      return {
        generatedAt: new Date().toISOString(),
        status: 'dry-run',
        provider,
        message:
          'Dry run only. No database rows were changed. Set PRIVATE_KEY_ENCRYPTION_KEY_VERSION to the intended target version, then repeat this request with dryRun=false to re-encrypt stored private keys.',
        warnings: provider.usesDevelopmentFallback
          ? [
              'The development fallback master key is active. Configure PRIVATE_KEY_ENCRYPTION_MASTER_KEY before running a production rotation.',
            ]
          : [],
        reason: dto.reason?.trim() || null,
      };
    }

    const result = await this.privateKeyEncryption.migrateStoredPrivateKeys();

    return {
      generatedAt: new Date().toISOString(),
      status: 'completed',
      provider,
      certificatesUpdated: result.certificatesUpdated,
      artifactsUpdated: result.artifactsUpdated,
      message:
        'Stored certificate private keys were re-encrypted with the active provider configuration.',
      reason: dto.reason?.trim() || null,
    };
  }

  getInternalCertificateRotationHook(dto: RotateInternalCertsDto) {
    return {
      generatedAt: new Date().toISOString(),
      supported: false,
      status: 'not-configured',
      currentTransport: {
        protocol:
          process.env['CLUSTER_CONTROL_PROTOCOL']?.trim().toLowerCase() ||
          'http',
        mtlsEnabled: false,
        actorIdentity: 'jwt-or-api-key-bridge',
      },
      message:
        'Internal node mTLS certificates are not active yet. This endpoint reserves the future rotation contract and documents the prerequisites for that workflow.',
      requestedMaintenanceWindow: dto.maintenanceWindow?.trim() || null,
      reason: dto.reason?.trim() || null,
      prerequisites: [
        'Enable per-node internal TLS identities for control-plane traffic.',
        'Distribute a cluster trust bundle/CA to all nodes.',
        'Convert internal HTTP requests to mTLS-authenticated transport.',
        'Back the rotation with a durable cluster operation once internal PKI exists.',
      ],
      futureContract: {
        endpoint: 'POST /security/rotate/internal-certs',
        expectedResponse:
          '202 Accepted with an operationId once internal PKI is implemented.',
        trackingEndpoints: [
          '/security/status',
          '/cluster/operations/:operationId',
        ],
      },
    };
  }

  private buildSecretCheck(params: {
    name: string;
    configured: boolean;
    requiredInProduction: boolean;
    usingDevelopmentFallback?: boolean;
    details?: Record<string, unknown>;
  }) {
    return {
      name: params.name,
      configured: params.configured,
      requiredInProduction: params.requiredInProduction,
      usingDevelopmentFallback: params.usingDevelopmentFallback ?? false,
      status: !params.configured
        ? 'missing'
        : params.usingDevelopmentFallback
          ? 'degraded'
          : 'ok',
      details: params.details ?? {},
    };
  }

  private validateApiKeyCandidate(
    candidate: string,
    configuredApiKeys: ConfiguredApiKeySummary[],
  ) {
    const normalized = candidate.trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!normalized) {
      errors.push('A non-empty nextApiKey value is required.');
    }
    if (normalized.length > 0 && normalized.length < 24) {
      errors.push('API keys should be at least 24 characters long.');
    }
    if (/[\s,]/.test(normalized)) {
      errors.push(
        'API keys must not contain whitespace or commas because API_KEY uses comma-separated values.',
      );
    }
    if (/[^\x21-\x7E]/.test(normalized)) {
      errors.push('API keys must contain only printable ASCII characters.');
    }
    if (normalized && this.authService.validateApiKey(normalized)) {
      errors.push('The candidate API key is already configured.');
    }

    const characterClasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(
      (pattern) => pattern.test(normalized),
    ).length;
    if (normalized && characterClasses < 3) {
      warnings.push(
        'Use a mix of upper-case, lower-case, numeric, and symbol characters for stronger entropy.',
      );
    }
    if (configuredApiKeys.length >= 2) {
      warnings.push(
        'Multiple API keys are already configured. Keep the overlap window short and remove retired keys promptly after validation.',
      );
    }

    return {
      valid: errors.length === 0,
      fingerprint: normalized
        ? this.authService.fingerprintApiKey(normalized)
        : null,
      maskedPreview: normalized
        ? `${normalized.slice(0, 4)}…${normalized.slice(-4)}`
        : null,
      length: normalized.length,
      warnings,
      errors,
    };
  }

  private buildBridgeToken(identity: AuthIdentity, shouldIssue: boolean) {
    if (!shouldIssue) {
      return {
        issued: false,
        reason: 'issueBridgeToken was not requested.',
      };
    }

    if (!this.authService.canIssueAccessTokens()) {
      return {
        issued: false,
        reason:
          'AUTH_JWT_SECRET is not configured, so the application cannot mint bridge bearer tokens.',
      };
    }

    return {
      issued: true,
      token: this.authService.issueAccessToken(identity),
      notes: [
        'Use this bridge token to validate bearer-token auth before retiring legacy API keys.',
        'The token carries the current caller identity and expires according to AUTH_ACCESS_TOKEN_TTL_SECONDS.',
      ],
    };
  }

  private hasAnyRole(effectiveRoles: string[], requiredRoles: string[]) {
    return requiredRoles.some((role) => effectiveRoles.includes(role));
  }

  private presentIdentity(identity: AuthIdentity) {
    return {
      id: identity.id,
      subject: identity.subject,
      actorType: identity.actorType,
      authMethod: identity.authMethod,
      displayName: identity.displayName,
      roles: [...identity.roles],
      effectiveRoles: resolveEffectiveRoles(identity),
      scopes: [...identity.scopes],
      audience: [...identity.audience],
      issuer: identity.issuer,
      apiKeyId: identity.apiKeyId,
      nodeId: identity.nodeId,
      tokenId: identity.tokenId,
      issuedAt: identity.issuedAt,
      expiresAt: identity.expiresAt,
    };
  }

  private safePathExists(candidatePath: string | undefined) {
    if (!candidatePath) {
      return false;
    }

    try {
      return fs.existsSync(candidatePath);
    } catch {
      return false;
    }
  }
}
