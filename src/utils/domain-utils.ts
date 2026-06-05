import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

/**
 * Utilities for handling domain lists stored as ';'-joined strings.
 */

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type NormalizeDomainOptions = {
  allowWildcard?: boolean;
};

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

function toSafeErrorMessage(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? JSON.stringify(value.trim())
    : 'the provided value';
}

function ensureLabelRules(domain: string): void {
  const labels = domain.split('.');

  if (labels.length < 2) {
    throw new DomainValidationError(
      'Domains must be fully-qualified and include at least one dot',
    );
  }

  for (const label of labels) {
    if (label.length === 0) {
      throw new DomainValidationError('Domains cannot contain empty labels');
    }

    if (label.length > MAX_LABEL_LENGTH) {
      throw new DomainValidationError(
        `Domain labels cannot exceed ${MAX_LABEL_LENGTH} characters`,
      );
    }

    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      throw new DomainValidationError(
        `Invalid domain label ${JSON.stringify(label)}`,
      );
    }
  }
}

/** Strictly normalize and validate a single domain name. */
export function normalizeDomain(
  value: string,
  options: NormalizeDomainOptions = {},
): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError('Domain names must be strings');
  }

  let domain = value.trim().toLowerCase();
  if (!domain) {
    throw new DomainValidationError('Domain names cannot be empty');
  }

  if (/[\u0000-\u001f\u007f\s/\\]/.test(domain)) {
    throw new DomainValidationError(
      `Invalid domain ${toSafeErrorMessage(value)}: whitespace, control characters, and path separators are not allowed`,
    );
  }

  if (domain.endsWith('.')) {
    domain = domain.slice(0, -1);
  }

  if (!domain) {
    throw new DomainValidationError('Domain names cannot be empty');
  }

  const wildcard = domain.startsWith('*.');
  if (wildcard) {
    if (!options.allowWildcard) {
      throw new DomainValidationError(
        `Wildcard domains are not allowed here: ${toSafeErrorMessage(value)}`,
      );
    }

    domain = domain.slice(2);
  }

  if (domain.includes('*')) {
    throw new DomainValidationError(
      `Wildcards are only allowed as the left-most label: ${toSafeErrorMessage(value)}`,
    );
  }

  if (domain.includes('..')) {
    throw new DomainValidationError(
      `Invalid domain ${toSafeErrorMessage(value)}: consecutive dots are not allowed`,
    );
  }

  const asciiDomain = domainToASCII(domain);
  if (!asciiDomain) {
    throw new DomainValidationError(
      `Invalid domain ${toSafeErrorMessage(value)}: could not convert to ASCII`,
    );
  }

  if (isIP(asciiDomain) !== 0) {
    throw new DomainValidationError(
      `IP addresses are not valid certificate domains: ${toSafeErrorMessage(value)}`,
    );
  }

  if (asciiDomain.length > MAX_DOMAIN_LENGTH) {
    throw new DomainValidationError(
      `Domains cannot exceed ${MAX_DOMAIN_LENGTH} characters`,
    );
  }

  if (!/^[a-z0-9.-]+$/.test(asciiDomain)) {
    throw new DomainValidationError(
      `Invalid domain ${toSafeErrorMessage(value)}: unsupported characters detected`,
    );
  }

  ensureLabelRules(asciiDomain);

  return wildcard ? `*.${asciiDomain}` : asciiDomain;
}

/** Normalize and deduplicate a domain list while preserving the first-seen order. */
export function normalizeDomains(
  domains: string[],
  options: NormalizeDomainOptions = {},
): string[] {
  if (!Array.isArray(domains)) {
    throw new DomainValidationError('Domain input must be an array of strings');
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const domain of domains) {
    const normalizedDomain = normalizeDomain(domain, options);
    if (seen.has(normalizedDomain)) {
      continue;
    }

    normalized.push(normalizedDomain);
    seen.add(normalizedDomain);
  }

  if (normalized.length === 0) {
    throw new DomainValidationError('At least one domain is required');
  }

  return normalized;
}

/** Parse a semicolon-joined domain string into a validated array of normalized domains. */
export function parseDomains(
  domainsString: string,
  options: NormalizeDomainOptions = {},
): string[] {
  if (typeof domainsString !== 'string') {
    throw new DomainValidationError('Domain input must be a string');
  }

  return normalizeDomains(
    domainsString
      .split(';')
      .map((domain) => domain.trim())
      .filter(Boolean),
    options,
  );
}

/** Join an array of domains into a semicolon-joined string (no trailing ;) */
export function joinDomains(
  domains: string[],
  options: NormalizeDomainOptions = {},
): string {
  return normalizeDomains(domains, options).join(';');
}

/** Consistent hash for a normalized set of domains (used for cert uniqueness). */
export function hashDomains(
  domains: string[] | string,
  options: NormalizeDomainOptions = {},
): string {
  const normalizedDomains = Array.isArray(domains)
    ? normalizeDomains(domains as string[], options)
    : parseDomains(domains as string, options);

  return createHash('sha256')
    .update(JSON.stringify([...normalizedDomains].sort()))
    .digest('hex');
}

/** Build a safe, deterministic certificate storage directory name from a primary domain. */
export function getCertificateStorageName(domain: string): string {
  const normalized = normalizeDomain(domain, { allowWildcard: true });
  const wildcard = normalized.startsWith('*.');
  const baseDomain = wildcard ? normalized.slice(2) : normalized;
  const safeLabel = baseDomain
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const hash = createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 16);

  return `cert-${wildcard ? 'wild-' : ''}${safeLabel || 'domain'}-${hash}`;
}

export function containsWildcardDomain(domains: string[]): boolean {
  return normalizeDomains(domains, { allowWildcard: true }).some((domain) =>
    domain.startsWith('*.'),
  );
}
