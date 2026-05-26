import * as path from 'node:path';
import { containsWildcardDomain, getCertificateStorageName, normalizeDomains } from '../utils/domain-utils';

export const ACME_CHALLENGE_STRATEGIES = ['auto', 'http-01', 'dns-01'] as const;
export type AcmeChallengeStrategy = (typeof ACME_CHALLENGE_STRATEGIES)[number];

export const ACME_CHALLENGE_TYPES = ['http-01', 'dns-01'] as const;
export type AcmeChallengeType = (typeof ACME_CHALLENGE_TYPES)[number];

export type ResolvedAcmeStrategy = {
  requestedStrategy: AcmeChallengeStrategy;
  challengeType: AcmeChallengeType;
  provider: string;
  wildcard: boolean;
  sharedChallengeStore: boolean;
  propagationSeconds: number | null;
  challengeStore: 'database-http' | 'external-dns';
  visibleInChallengeApi: boolean;
};

export type AcmeCertbotPlan = {
  requestedStrategy: AcmeChallengeStrategy;
  challengeType: AcmeChallengeType;
  provider: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  metadata: Record<string, unknown>;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseAbsoluteHookPath(value: string | undefined, envName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${envName} must be configured with an absolute hook path`);
  }

  if (!path.isAbsolute(value)) {
    throw new Error(`${envName} must be an absolute filesystem path inside the container`);
  }

  return value;
}

function normalizeRequestedStrategy(value: string | undefined): AcmeChallengeStrategy {
  const normalized = value?.trim().toLowerCase() ?? 'auto';
  if ((ACME_CHALLENGE_STRATEGIES as readonly string[]).includes(normalized)) {
    return normalized as AcmeChallengeStrategy;
  }

  throw new Error(
    `Unsupported ACME_CHALLENGE_STRATEGY ${JSON.stringify(value)}. Expected one of: ${ACME_CHALLENGE_STRATEGIES.join(', ')}`,
  );
}

export function parseDatabaseUrlForCertbotHooks(databaseUrl: string): {
  username: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required for the built-in HTTP-01 ACME hook flow');
  }

  const parsed = (() => {
    try {
      return new URL(databaseUrl);
    } catch {
      throw new Error('Could not parse DATABASE_URL for ACME hooks');
    }
  })();

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error(
      `DATABASE_URL must use a PostgreSQL scheme for ACME hooks; received ${parsed.protocol}`,
    );
  }

  if (!parsed.username || !parsed.password || !parsed.hostname) {
    throw new Error(
      'DATABASE_URL must include username, password, and host for ACME hooks',
    );
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL must include a database name for ACME hooks');
  }

  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: decodeURIComponent(database),
  };
}

export function resolveAcmeStrategy(
  domainsInput: string[],
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAcmeStrategy {
  const domains = normalizeDomains(domainsInput, { allowWildcard: true });
  const wildcard = containsWildcardDomain(domains);
  const requestedStrategy = normalizeRequestedStrategy(
    env['ACME_CHALLENGE_STRATEGY'],
  );
  const challengeType =
    requestedStrategy === 'auto'
      ? wildcard
        ? 'dns-01'
        : 'http-01'
      : requestedStrategy;

  if (challengeType === 'http-01' && wildcard) {
    throw new Error(
      'Wildcard certificate issuance requires DNS-01. Set ACME_CHALLENGE_STRATEGY=dns-01 or leave it on auto with DNS hooks configured.',
    );
  }

  if (challengeType === 'dns-01') {
    return {
      requestedStrategy,
      challengeType,
      provider: env['ACME_DNS_PROVIDER']?.trim() || 'manual-dns-hook',
      wildcard,
      sharedChallengeStore: false,
      propagationSeconds: parsePositiveInteger(
        env['ACME_DNS_PROPAGATION_SECONDS'],
        30,
      ),
      challengeStore: 'external-dns',
      visibleInChallengeApi: false,
    };
  }

  return {
    requestedStrategy,
    challengeType,
    provider: env['ACME_HTTP01_PROVIDER']?.trim() || 'database-http-01',
    wildcard,
    sharedChallengeStore: true,
    propagationSeconds: parsePositiveInteger(
      env['ACME_HTTP01_PROPAGATION_SECONDS'],
      5,
    ),
    challengeStore: 'database-http',
    visibleInChallengeApi: true,
  };
}

export function buildAcmeCertbotPlan(params: {
  domains: string[];
  adminEmail: string;
  orderId: string;
  instanceId: string;
  env?: NodeJS.ProcessEnv;
}): AcmeCertbotPlan {
  const env = params.env ?? process.env;
  const domains = normalizeDomains(params.domains, { allowWildcard: true });
  const primaryDomain = domains[0];
  const strategy = resolveAcmeStrategy(domains, env);

  const args = [
    'certonly',
    '--manual',
    `--preferred-challenges=${strategy.challengeType === 'dns-01' ? 'dns' : 'http'}`,
    '--non-interactive',
    '--agree-tos',
    '--manual-public-ip-logging-ok',
    '--cert-name',
    getCertificateStorageName(primaryDomain),
    '-m',
    params.adminEmail,
    ...domains.flatMap((domain) => ['-d', domain]),
  ];

  if ((env['LETSENCRYPT_STAGING'] ?? '').trim().toLowerCase() === 'true') {
    args.push('--test-cert');
  }

  const metadata = {
    requestedStrategy: strategy.requestedStrategy,
    challengeType: strategy.challengeType,
    provider: strategy.provider,
    wildcard: strategy.wildcard,
    sharedChallengeStore: strategy.sharedChallengeStore,
    challengeStore: strategy.challengeStore,
    visibleInChallengeApi: strategy.visibleInChallengeApi,
    propagationSeconds: strategy.propagationSeconds,
  } satisfies Record<string, unknown>;

  if (strategy.challengeType === 'dns-01') {
    const authHookPath = parseAbsoluteHookPath(
      env['ACME_DNS_AUTH_HOOK'],
      'ACME_DNS_AUTH_HOOK',
    );
    const cleanupHookPath = parseAbsoluteHookPath(
      env['ACME_DNS_CLEANUP_HOOK'],
      'ACME_DNS_CLEANUP_HOOK',
    );

    args.push(
      `--manual-auth-hook=${authHookPath}`,
      `--manual-cleanup-hook=${cleanupHookPath}`,
    );

    return {
      requestedStrategy: strategy.requestedStrategy,
      challengeType: strategy.challengeType,
      provider: strategy.provider,
      args,
      env: {
        LYTTLE_ACME_ORDER_ID: params.orderId,
        LYTTLE_ACME_CHALLENGE_TYPE: strategy.challengeType,
        LYTTLE_ACME_PROVIDER: strategy.provider,
        LYTTLE_ACME_METADATA_JSON: JSON.stringify({
          ...metadata,
          domains,
          primaryDomain,
          requestedByNode: params.instanceId,
        }),
        ACME_DNS_PROPAGATION_SECONDS: String(strategy.propagationSeconds ?? 30),
      },
      metadata,
    };
  }

  const authHookPath =
    env['ACME_HTTP01_AUTH_HOOK']?.trim() || '/certbot-auth-hook.sh';
  const cleanupHookPath =
    env['ACME_HTTP01_CLEANUP_HOOK']?.trim() || '/certbot-cleanup-hook.sh';

  if (!path.isAbsolute(authHookPath) || !path.isAbsolute(cleanupHookPath)) {
    throw new Error(
      'ACME_HTTP01_AUTH_HOOK and ACME_HTTP01_CLEANUP_HOOK must be absolute paths inside the container',
    );
  }

  const database = parseDatabaseUrlForCertbotHooks(env['DATABASE_URL'] ?? '');
  args.push(
    `--manual-auth-hook=${authHookPath}`,
    `--manual-cleanup-hook=${cleanupHookPath}`,
  );

  return {
    requestedStrategy: strategy.requestedStrategy,
    challengeType: strategy.challengeType,
    provider: strategy.provider,
    args,
    env: {
      DB_USER: database.username,
      DB_PASSWORD: database.password,
      DB_HOST: database.host,
      DB_PORT: database.port,
      DB_NAME: database.database,
      LYTTLE_ACME_ORDER_ID: params.orderId,
      LYTTLE_ACME_CHALLENGE_TYPE: strategy.challengeType,
      LYTTLE_ACME_PROVIDER: strategy.provider,
      LYTTLE_ACME_METADATA_JSON: JSON.stringify({
        ...metadata,
        domains,
        primaryDomain,
        requestedByNode: params.instanceId,
      }),
      ACME_HTTP01_PROPAGATION_SECONDS: String(strategy.propagationSeconds ?? 5),
    },
    metadata,
  };
}

