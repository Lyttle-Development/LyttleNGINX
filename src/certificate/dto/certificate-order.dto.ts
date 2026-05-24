import type {
  CertificateOrderSourceType,
  CertificateOrderStatus,
} from '../certificate-order.constants';

export class CertificateOrderArtifactDto {
  id: string;
  certificateId: string | null;
  version: number;
  sourceType: CertificateOrderSourceType;
  issuedAt: Date;
  expiresAt: Date;
  activatedAt: Date | null;
  createdByNode: string | null;
  createdAt: Date;
}

export class CertificateOrderEventDto {
  id: string;
  eventType: string;
  fromStatus: CertificateOrderStatus | null;
  toStatus: CertificateOrderStatus | null;
  message: string | null;
  attemptNumber: number | null;
  retryAt: Date | null;
  details: Record<string, unknown> | null;
  occurredAt: Date;
}

export class CertificateOrderSummaryDto {
  id: string;
  domains: string[];
  primaryDomain: string;
  sourceType: CertificateOrderSourceType;
  status: CertificateOrderStatus;
  attemptCount: number;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  certificateId: string | null;
  requestedByNode: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  challengePublishedAt: Date | null;
  validatingAt: Date | null;
  issuedAt: Date | null;
  distributingAt: Date | null;
  activatedAt: Date | null;
  failedAt: Date | null;
  revokedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CertificateOrderDetailDto extends CertificateOrderSummaryDto {
  events: CertificateOrderEventDto[];
  artifacts: CertificateOrderArtifactDto[];
}
