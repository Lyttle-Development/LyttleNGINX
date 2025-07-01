/**
 * Utilities for handling domain lists stored as ';'-joined strings.
 */

/** Parse a semicolon-joined domain string into an array of trimmed domains */
export function parseDomains(domainsString: string): string[] {
  return domainsString
    .split(';')
    .map(d => d.trim())
    .filter(Boolean);
}

/** Join an array of domains into a semicolon-joined string (no trailing ;) */
export function joinDomains(domains: string[]): string {
  return domains.map(d => d.trim()).filter(Boolean).join(';');
}

/** Consistent hash for a set of domains (used for cert uniqueness) */
export function hashDomains(domains: string[] | string): string {
  const arr = Array.isArray(domains) ? domains : parseDomains(domains);
  const sorted = [...arr].sort();
  return require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex');
}