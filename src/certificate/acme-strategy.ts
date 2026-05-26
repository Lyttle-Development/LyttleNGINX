import * as path from 'node:path';
import { containsWildcardDomain, normalizeDomains } from '../utils/domain-utils';

export const ACME_CHALLENGE_STRATEGIES = ['auto', 'http-01'] as const;
export type AcmeChallengeStrategy = (typeof ACME_CHALLENGE_STRATEGIES)[number];

export const ACME_CHALLENGE_TYPES = ['http-01'] as const;
export type AcmeChallengeType = (typeof ACME_CHALLENGE_TYPES)[number];

export type ResolvedAcmeStrategy = {
  requestedStrategy: AcmeChallengeStrategy;
  challengeType: AcmeChallengeType;
  provider: string;
  wildcard: boolean;
  sharedChallengeStore: boolean;
  propagationSeconds: number | null;
  challengeStore: 'database-http';
  visibleInChallengeApi: boolean;
};

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeRequestedStrategy(
  value: string | undefined,
): AcmeChallengeStrategy {
  const normalized = value?.trim().toLowerCase() ?? 'auto';
  if (normalized === 'dns-01') {
    throw new Error(
      'ACME_CHALLENGE_STRATEGY=dns-01 is not supported in the production-hardened Session 18 flow because it would require DNS TXT record changes. Use auto/http-01 with non-wildcard hostnames or import a certificate instead.',
    );
  }

  if ((ACME_CHALLENGE_STRATEGIES as readonly string[]).includes(normalized)) {
    return normalized as AcmeChallengeStrategy;
  }

  throw new Error(
    `Unsupported ACME_CHALLENGE_STRATEGY ${JSON.stringify(value)}. Expected one of: ${ACME_CHALLENGE_STRATEGIES.join(', ')}`,
  );
}

function parseAbsolutePath(
  value: string | undefined,
  envName: string,
): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  if (!path.isAbsolute(value)) {
    throw new Error(`${envName} must be an absolute filesystem path`);
  }

  return value;
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
  if (wildcard) {
    throw new Error(
      'Wildcard certificate issuance is not supported by the production-hardened Session 18 ACME flow because it would require DNS TXT record changes. Use explicit hostnames or import/upload the certificate instead.',
    );
  }

  return {
    requestedStrategy,
    challengeType: 'http-01',
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

export function getAcmeDirectoryUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env['ACME_DIRECTORY_URL']?.trim();
  if (override) {
    return override;
  }

  return (env['LETSENCRYPT_STAGING'] ?? '').trim().toLowerCase() === 'true'
    ? 'https://acme-staging-v02.api.letsencrypt.org/directory'
    : 'https://acme-v02.api.letsencrypt.org/directory';
}

export function getAcmeAccountKeyPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    parseAbsolutePath(env['ACME_ACCOUNT_PRIVATE_KEY_PATH'], 'ACME_ACCOUNT_PRIVATE_KEY_PATH') ??
    '/app/state/acme/account.pem'
  );
}


export function getAcmeHttpVerificationTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInteger(
    env['ACME_HTTP01_VERIFICATION_TIMEOUT_MS'],
    30 * 1000,
  );
}

export function getAcmeHttpPollIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInteger(env['ACME_HTTP01_POLL_INTERVAL_MS'], 2000);
}
