export const CERTIFICATE_ORDER_STATUSES = [
  'requested',
  'challenge-published',
  'validating',
  'issued',
  'distributing',
  'activated',
  'failed',
  'revoked',
] as const;

export type CertificateOrderStatus =
  (typeof CERTIFICATE_ORDER_STATUSES)[number];

export const CERTIFICATE_ORDER_SOURCE_TYPES = [
  'acme',
  'uploaded',
  'self-signed',
  'imported',
] as const;

export type CertificateOrderSourceType =
  (typeof CERTIFICATE_ORDER_SOURCE_TYPES)[number];

export const IN_PROGRESS_CERTIFICATE_ORDER_STATUSES: readonly CertificateOrderStatus[] =
  ['requested', 'challenge-published', 'validating', 'issued', 'distributing'];

export const TERMINAL_CERTIFICATE_ORDER_STATUSES: readonly CertificateOrderStatus[] =
  ['activated', 'failed', 'revoked'];

export const RETRYABLE_CERTIFICATE_ORDER_STATUSES: readonly CertificateOrderStatus[] =
  ['failed'];

export function isTerminalCertificateOrderStatus(
  status: string,
): status is CertificateOrderStatus {
  return TERMINAL_CERTIFICATE_ORDER_STATUSES.includes(
    status as CertificateOrderStatus,
  );
}
