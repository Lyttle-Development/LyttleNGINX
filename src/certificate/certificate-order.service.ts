import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashDomains,
  joinDomains,
  normalizeDomains,
  parseDomains,
} from '../utils/domain-utils';
import {
  CERTIFICATE_ORDER_SOURCE_TYPES,
  type CertificateOrderSourceType,
  type CertificateOrderStatus,
  IN_PROGRESS_CERTIFICATE_ORDER_STATUSES,
  RETRYABLE_CERTIFICATE_ORDER_STATUSES,
} from './certificate-order.constants';
import {
  CertificateOrderDetailDto,
  CertificateOrderSummaryDto,
} from './dto/certificate-order.dto';

const STATUS_TIMESTAMP_FIELDS: Partial<Record<CertificateOrderStatus, string>> =
  {
    requested: 'requestedAt',
    'challenge-published': 'challengePublishedAt',
    validating: 'validatingAt',
    issued: 'issuedAt',
    distributing: 'distributingAt',
    activated: 'activatedAt',
    failed: 'failedAt',
    revoked: 'revokedAt',
  };

type CertificateOrderRecord = {
  id: string;
  domains: string;
  domainsHash: string;
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
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

type CertificateOrderEventRecord = {
  id: string;
  eventType: string;
  fromStatus: CertificateOrderStatus | null;
  toStatus: CertificateOrderStatus | null;
  message: string | null;
  attemptNumber: number | null;
  retryAt: Date | null;
  details: Record<string, unknown> | null;
  occurredAt: Date;
};

type CertificateArtifactRecord = {
  id: string;
  orderId: string | null;
  certificateId: string | null;
  domainsHash: string;
  version: number;
  sourceType: CertificateOrderSourceType;
  issuedAt: Date;
  expiresAt: Date;
  activatedAt: Date | null;
  isCurrent: boolean;
  distributionStatus: string | null;
  distributionOperationId: string | null;
  distributionCompletedAt: Date | null;
  createdByNode: string | null;
  createdAt: Date;
};

type ClusterOperationAckRecord = {
  nodeInstanceId: string;
  nodeHostname: string | null;
  endpointUrl: string | null;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  ackedAt: Date | null;
  details: Record<string, unknown> | null;
};

type ClusterOperationWithAcks = {
  id: string;
  status: string;
  completedAt: Date | null;
  acknowledgements: ClusterOperationAckRecord[];
};

type LatestDistributionRecord = {
  artifact: CertificateArtifactRecord;
  operation: ClusterOperationWithAcks;
};

@Injectable()
export class CertificateOrderService {
  private readonly logger = new Logger(CertificateOrderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateOrder(params: {
    domains: string[];
    sourceType: CertificateOrderSourceType;
    requestedByNode?: string | null;
    existingOrderId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CertificateOrderRecord> {
    const domains = normalizeDomains(params.domains, { allowWildcard: true });
    const domainsHash = hashDomains(domains, { allowWildcard: true });

    if (params.existingOrderId) {
      const existingOrder = (await this.prisma.certificateOrder.findUnique({
        where: { id: params.existingOrderId },
      })) as CertificateOrderRecord | null;

      if (!existingOrder) {
        throw new Error(
          `Certificate order not found: ${params.existingOrderId}`,
        );
      }

      return existingOrder;
    }

    const activeOrder = (await this.prisma.certificateOrder.findFirst({
      where: {
        domainsHash,
        status: { in: [...IN_PROGRESS_CERTIFICATE_ORDER_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    })) as CertificateOrderRecord | null;

    if (activeOrder) {
      return activeOrder;
    }

    const retryableOrder = (await this.prisma.certificateOrder.findFirst({
      where: {
        domainsHash,
        status: { in: [...RETRYABLE_CERTIFICATE_ORDER_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    })) as CertificateOrderRecord | null;

    if (
      retryableOrder &&
      (!retryableOrder.nextRetryAt || retryableOrder.nextRetryAt <= new Date())
    ) {
      return this.resumeOrder(retryableOrder.id, {
        reason: 'Automatic retry window reached',
        force: true,
      });
    }

    const order = (await this.prisma.certificateOrder.create({
      data: {
        domains: joinDomains(domains, { allowWildcard: true }),
        domainsHash,
        primaryDomain: domains[0],
        sourceType: params.sourceType,
        status: 'requested',
        attemptCount: 1,
        retryCount: 0,
        requestedByNode: params.requestedByNode ?? null,
        requestedAt: new Date(),
        metadata: params.metadata ?? undefined,
      },
    })) as CertificateOrderRecord;

    await this.recordEvent(order.id, {
      eventType: 'created',
      toStatus: 'requested',
      message: `Created ${params.sourceType} certificate order for ${order.primaryDomain}`,
      attemptNumber: order.attemptCount,
      details: params.metadata ?? null,
    });

    return order;
  }

  async resumeOrder(
    orderId: string,
    options: {
      reason: string;
      force?: boolean;
    },
  ): Promise<CertificateOrderRecord> {
    const order = (await this.prisma.certificateOrder.findUnique({
      where: { id: orderId },
    })) as CertificateOrderRecord | null;

    if (!order) {
      throw new Error(`Certificate order not found: ${orderId}`);
    }

    if (
      !options.force &&
      order.nextRetryAt &&
      order.nextRetryAt.getTime() > Date.now()
    ) {
      throw new Error(
        `Certificate order ${orderId} is scheduled to retry at ${order.nextRetryAt.toISOString()}`,
      );
    }

    const now = new Date();
    const updated = (await this.prisma.certificateOrder.update({
      where: { id: orderId },
      data: {
        status: 'requested',
        nextRetryAt: null,
        lastError: null,
        startedAt: null,
        challengePublishedAt: null,
        validatingAt: null,
        issuedAt: null,
        distributingAt: null,
        activatedAt: null,
        failedAt: null,
        revokedAt: null,
        completedAt: null,
        requestedAt: now,
        attemptCount: { increment: 1 },
        retryCount: { increment: 1 },
      },
    })) as CertificateOrderRecord;

    await this.recordEvent(orderId, {
      eventType: 'retry-requested',
      fromStatus: order.status,
      toStatus: 'requested',
      message: options.reason,
      attemptNumber: updated.attemptCount,
      details: {
        forced: Boolean(options.force),
      },
    });

    return updated;
  }

  async transitionOrder(
    orderId: string,
    nextStatus: CertificateOrderStatus,
    options: {
      message?: string;
      details?: Record<string, unknown> | null;
      lastError?: string | null;
      nextRetryAt?: Date | null;
      data?: Record<string, unknown>;
    } = {},
  ): Promise<CertificateOrderRecord> {
    const order = (await this.prisma.certificateOrder.findUnique({
      where: { id: orderId },
    })) as CertificateOrderRecord | null;

    if (!order) {
      throw new Error(`Certificate order not found: ${orderId}`);
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      ...options.data,
      status: nextStatus,
    };

    const timestampField = STATUS_TIMESTAMP_FIELDS[nextStatus];
    if (timestampField) {
      data[timestampField] = now;
    }

    if (nextStatus === 'challenge-published' && !order.startedAt) {
      data.startedAt = now;
    }

    if (['activated', 'failed', 'revoked'].includes(nextStatus)) {
      data.completedAt = now;
    }

    if (options.lastError !== undefined) {
      data.lastError = options.lastError;
    }

    if (options.nextRetryAt !== undefined) {
      data.nextRetryAt = options.nextRetryAt;
    } else if (nextStatus !== 'failed') {
      data.nextRetryAt = null;
    }

    const updated = (await this.prisma.certificateOrder.update({
      where: { id: orderId },
      data,
    })) as CertificateOrderRecord;

    await this.recordEvent(orderId, {
      eventType: 'state-transition',
      fromStatus: order.status,
      toStatus: nextStatus,
      message: options.message ?? null,
      attemptNumber: updated.attemptCount,
      retryAt: options.nextRetryAt ?? null,
      details: options.details ?? null,
    });

    return updated;
  }

  async markFailure(
    orderId: string,
    error: string,
    nextRetryAt: Date | null,
    details: Record<string, unknown> | null = null,
  ): Promise<CertificateOrderRecord> {
    const updated = await this.transitionOrder(orderId, 'failed', {
      message: error,
      lastError: error,
      nextRetryAt,
      details,
    });

    if (nextRetryAt) {
      await this.recordEvent(orderId, {
        eventType: 'retry-scheduled',
        fromStatus: 'failed',
        toStatus: 'failed',
        message: `Retry scheduled for ${nextRetryAt.toISOString()}`,
        attemptNumber: updated.attemptCount,
        retryAt: nextRetryAt,
        details,
      });
    }

    return updated;
  }

  async completeWithCertificate(
    orderId: string,
    params: {
      certificateId: string;
      message: string;
      details?: Record<string, unknown> | null;
    },
  ): Promise<CertificateOrderRecord> {
    return this.transitionOrder(orderId, 'activated', {
      message: params.message,
      details: params.details ?? null,
      data: {
        certificateId: params.certificateId,
        lastError: null,
      },
    });
  }

  async recordArtifact(params: {
    orderId: string;
    certificateId?: string | null;
    domains: string[];
    sourceType: CertificateOrderSourceType;
    certPem: string;
    keyPem: string;
    issuedAt: Date;
    expiresAt: Date;
    activatedAt?: Date | null;
    createdByNode?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ id: string; version: number }> {
    const domains = normalizeDomains(params.domains, { allowWildcard: true });
    const domainsHash = hashDomains(domains, { allowWildcard: true });
    const latestArtifact =
      (await this.prisma.certificateArtifactVersion.findFirst({
        where: { domainsHash },
        orderBy: { version: 'desc' },
      })) as { version: number } | null;
    const version = (latestArtifact?.version ?? 0) + 1;

    const artifact = (await this.prisma.certificateArtifactVersion.create({
      data: {
        orderId: params.orderId,
          certificateId: params.certificateId ?? null,
        domains: joinDomains(domains, { allowWildcard: true }),
        domainsHash,
        version,
        sourceType: params.sourceType,
        certPem: params.certPem,
        keyPem: params.keyPem,
        issuedAt: params.issuedAt,
        expiresAt: params.expiresAt,
        activatedAt: params.activatedAt ?? null,
        createdByNode: params.createdByNode ?? null,
        metadata: params.metadata ?? undefined,
      },
    })) as { id: string; version: number };

    await this.recordEvent(params.orderId, {
      eventType: 'artifact-created',
      message: `Stored certificate artifact version ${version}`,
      attemptNumber: null,
      details: {
        artifactId: artifact.id,
        version,
        certificateId: params.certificateId,
        sourceType: params.sourceType,
      },
    });

    return artifact;
  }

  async getLatestArtifactForOrder(orderId: string) {
    return (await this.prisma.certificateArtifactVersion.findFirst({
      where: { orderId },
      orderBy: { version: 'desc' },
    })) as CertificateArtifactRecord | null;
  }

  async getArtifact(artifactId: string) {
    return (await this.prisma.certificateArtifactVersion.findUnique({
      where: { id: artifactId },
    })) as (CertificateArtifactRecord & {
      domains: string;
      domainsHash: string;
      certPem: string;
      keyPem: string;
      metadata: Record<string, unknown> | null;
      orderId: string | null;
    }) | null;
  }

  async getCurrentArtifactForDomainsHash(domainsHash: string) {
    return (await this.prisma.certificateArtifactVersion.findFirst({
      where: {
        domainsHash,
        isCurrent: true,
      },
      orderBy: { version: 'desc' },
    })) as CertificateArtifactRecord | null;
  }

  async getRollbackArtifactForDomainsHash(
    domainsHash: string,
    currentVersion: number,
  ) {
    return (await this.prisma.certificateArtifactVersion.findFirst({
      where: {
        domainsHash,
        version: { lt: currentVersion },
        activatedAt: { not: null },
      },
      orderBy: { version: 'desc' },
    })) as CertificateArtifactRecord | null;
  }

  async listOrders(limit = 25): Promise<{
    count: number;
    orders: CertificateOrderSummaryDto[];
  }> {
    const take = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 100)
      : 25;
    const orders = (await this.prisma.certificateOrder.findMany({
      take,
      orderBy: { createdAt: 'desc' },
    })) as CertificateOrderRecord[];

    return {
      count: orders.length,
      orders: orders.map((order) => this.toSummaryDto(order)),
    };
  }

  async getOrder(orderId: string): Promise<CertificateOrderDetailDto> {
    const order = (await this.prisma.certificateOrder.findUnique({
      where: { id: orderId },
      include: {
        events: {
          orderBy: { occurredAt: 'desc' },
        },
        artifacts: {
          orderBy: { version: 'desc' },
        },
      },
    })) as
      | (CertificateOrderRecord & {
          events: CertificateOrderEventRecord[];
          artifacts: CertificateArtifactRecord[];
        })
      | null;

    if (!order) {
      throw new Error(`Certificate order not found: ${orderId}`);
    }

    const latestDistribution = await this.getLatestDistribution(order.artifacts);

    return this.toDetailDto(order, latestDistribution);
  }

  async validateRetryableOrder(
    orderId: string,
  ): Promise<CertificateOrderRecord> {
    const order = (await this.prisma.certificateOrder.findUnique({
      where: { id: orderId },
    })) as CertificateOrderRecord | null;

    if (!order) {
      throw new Error(`Certificate order not found: ${orderId}`);
    }

    if (!CERTIFICATE_ORDER_SOURCE_TYPES.includes(order.sourceType)) {
      throw new Error(
        `Certificate order ${orderId} has unsupported source type ${String(order.sourceType)}`,
      );
    }

    return order;
  }

  private async recordEvent(
    orderId: string,
    params: {
      eventType: string;
      fromStatus?: CertificateOrderStatus | null;
      toStatus?: CertificateOrderStatus | null;
      message?: string | null;
      attemptNumber?: number | null;
      retryAt?: Date | null;
      details?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await this.prisma.certificateOrderEvent.create({
      data: {
        orderId,
        eventType: params.eventType,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus ?? null,
        message: params.message ?? null,
        attemptNumber: params.attemptNumber ?? null,
        retryAt: params.retryAt ?? null,
        details: params.details ?? undefined,
      },
    });
  }

  private toSummaryDto(
    order: CertificateOrderRecord,
  ): CertificateOrderSummaryDto {
    return {
      id: order.id,
      domains: parseDomains(order.domains, { allowWildcard: true }),
      primaryDomain: order.primaryDomain,
      sourceType: order.sourceType,
      status: order.status,
      attemptCount: order.attemptCount,
      retryCount: order.retryCount,
      nextRetryAt: order.nextRetryAt,
      lastError: order.lastError,
      certificateId: order.certificateId,
      requestedByNode: order.requestedByNode,
      requestedAt: order.requestedAt,
      startedAt: order.startedAt,
      challengePublishedAt: order.challengePublishedAt,
      validatingAt: order.validatingAt,
      issuedAt: order.issuedAt,
      distributingAt: order.distributingAt,
      activatedAt: order.activatedAt,
      failedAt: order.failedAt,
      revokedAt: order.revokedAt,
      completedAt: order.completedAt,
      metadata: order.metadata,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toDetailDto(
    order: CertificateOrderRecord & {
      events: CertificateOrderEventRecord[];
      artifacts: CertificateArtifactRecord[];
    },
    latestDistribution: LatestDistributionRecord | null,
  ): CertificateOrderDetailDto {
    return {
      ...this.toSummaryDto(order),
      events: order.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        message: event.message,
        attemptNumber: event.attemptNumber,
        retryAt: event.retryAt,
        details: event.details,
        occurredAt: event.occurredAt,
      })),
      artifacts: order.artifacts.map((artifact) => ({
        id: artifact.id,
        certificateId: artifact.certificateId,
        version: artifact.version,
        sourceType: artifact.sourceType,
        issuedAt: artifact.issuedAt,
        expiresAt: artifact.expiresAt,
        activatedAt: artifact.activatedAt,
        isCurrent: artifact.isCurrent,
        distributionStatus: artifact.distributionStatus,
        distributionOperationId: artifact.distributionOperationId,
        distributionCompletedAt: artifact.distributionCompletedAt,
        createdByNode: artifact.createdByNode,
        createdAt: artifact.createdAt,
      })),
      latestDistribution:
        latestDistribution
          ? {
              artifactId: latestDistribution.artifact.id,
              version: latestDistribution.artifact.version,
              status: latestDistribution.operation.status,
              operationId: latestDistribution.operation.id,
              completedAt: latestDistribution.operation.completedAt,
              acknowledgements: latestDistribution.operation.acknowledgements.map((ack) => ({
                nodeInstanceId: ack.nodeInstanceId,
                nodeHostname: ack.nodeHostname,
                endpointUrl: ack.endpointUrl,
                status: ack.status,
                responseStatus: ack.responseStatus,
                errorMessage: ack.errorMessage,
                startedAt: ack.startedAt,
                ackedAt: ack.ackedAt,
                details: ack.details,
              })),
            }
          : null,
    };
  }

  private async getLatestDistribution(
    artifacts: CertificateArtifactRecord[],
  ): Promise<LatestDistributionRecord | null> {
    const latestArtifact = artifacts
      .filter((artifact) => typeof artifact.distributionOperationId === 'string')
      .sort((left, right) => {
        const leftTime = left.distributionCompletedAt?.getTime() ?? 0;
        const rightTime = right.distributionCompletedAt?.getTime() ?? 0;
        return rightTime - leftTime || right.version - left.version;
      })[0];

    if (!latestArtifact?.distributionOperationId) {
      return null;
    }

    const operation = (await this.prisma.clusterOperation.findUnique({
      where: { id: latestArtifact.distributionOperationId },
      include: {
        acknowledgements: {
          orderBy: [{ nodeHostname: 'asc' }, { nodeInstanceId: 'asc' }],
        },
      },
    })) as ClusterOperationWithAcks | null;

    return operation
      ? {
          artifact: latestArtifact,
          operation,
        }
      : null;
  }
}
