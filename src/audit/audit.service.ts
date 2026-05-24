import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent as PrismaAuditEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditQueryOptions,
  AuditTargetDescriptor,
  AuditTargetValue,
  AuditWriteInput,
} from './types/audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly nodeId =
    process.env['CLUSTER_NODE_ID']?.trim() ||
    process.env['HOSTNAME']?.trim() ||
    'unknown-node';

  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(input: AuditWriteInput) {
    const normalizedTarget = this.normalizeTarget(input.target);
    const metadata = input.metadata
      ? (input.metadata as Prisma.InputJsonValue)
      : undefined;

    try {
      await this.prisma.auditEvent.create({
        data: {
          action: input.action,
          outcome: input.outcome,
          result: this.resolveResultSummary(input),
          correlationId: input.correlationId,
          actorId: input.actor?.id,
          actorSubject: input.actor?.subject,
          actorType: input.actor?.actorType,
          actorDisplayName: input.actor?.displayName,
          actorAuthMethod: input.actor?.authMethod,
          actorRoles: input.actor?.roles?.join(','),
          requestMethod: input.requestMethod,
          requestPath: input.requestPath,
          responseStatus: input.responseStatus,
          nodeId: this.nodeId,
          ipAddress: input.ipAddress,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          targetType: normalizedTarget?.type,
          targetId: normalizedTarget?.id,
          targetDisplay: normalizedTarget?.label,
          metadata,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist audit event for ${input.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async listEvents(options: AuditQueryOptions) {
    const where: Prisma.AuditEventWhereInput = {};

    if (options.action) {
      where.action = {
        contains: options.action,
        mode: 'insensitive',
      };
    }

    if (options.actorSubject) {
      where.actorSubject = {
        contains: options.actorSubject,
        mode: 'insensitive',
      };
    }

    if (options.correlationId) {
      where.correlationId = options.correlationId;
    }

    if (options.outcome) {
      where.outcome = options.outcome;
    }

    const records = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: options.limit,
    });

    return records.map((record) => this.presentEvent(record));
  }

  private resolveResultSummary(input: AuditWriteInput) {
    if (input.outcome === 'success') {
      return `HTTP ${input.responseStatus}`;
    }

    if (input.errorMessage) {
      return input.errorMessage;
    }

    return `HTTP ${input.responseStatus}`;
  }

  private normalizeTarget(
    target: AuditTargetValue,
  ): AuditTargetDescriptor | undefined {
    if (!target) {
      return undefined;
    }

    if (typeof target === 'string') {
      return {
        label: target,
      };
    }

    return {
      type: target.type?.trim() || undefined,
      id: target.id?.trim() || undefined,
      label: target.label?.trim() || undefined,
    };
  }

  private presentEvent(record: PrismaAuditEvent) {
    return {
      id: record.id,
      action: record.action,
      outcome: record.outcome,
      result: record.result,
      correlationId: record.correlationId,
      occurredAt: record.occurredAt,
      actor: record.actorId
        ? {
            id: record.actorId,
            subject: record.actorSubject,
            actorType: record.actorType,
            displayName: record.actorDisplayName,
            authMethod: record.actorAuthMethod,
            roles: record.actorRoles?.split(',').filter(Boolean) || [],
          }
        : null,
      target:
        record.targetType || record.targetId || record.targetDisplay
          ? {
              type: record.targetType,
              id: record.targetId,
              label: record.targetDisplay,
            }
          : null,
      request: {
        method: record.requestMethod,
        path: record.requestPath,
        responseStatus: record.responseStatus,
        ipAddress: record.ipAddress,
      },
      nodeId: record.nodeId,
      error:
        record.errorCode || record.errorMessage
          ? {
              code: record.errorCode,
              message: record.errorMessage,
            }
          : null,
      metadata: record.metadata,
    };
  }
}
