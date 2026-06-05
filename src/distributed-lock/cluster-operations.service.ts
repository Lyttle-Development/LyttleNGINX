import { Injectable, Logger } from '@nestjs/common';
import * as os from 'node:os';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaNullableJsonValue } from '../prisma/prisma-json.util';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { DistributedLockService } from './distributed-lock.service';
import { AuthIdentity } from '../auth/types/auth-identity';
import { buildClusterNodeUrl } from '../utils/network-utils';
import { runWithLogContext } from '../logs/log-context';

type ClusterNodeTarget = Awaited<
  ReturnType<ClusterHeartbeatService['getActiveNodes']>
>[number];

type ClusterOperationRecord = {
  id: string;
  operationType: string;
  scope: string;
  status: string;
  initiatorNodeId: string | null;
  initiatorHostname: string | null;
  initiatorActorId: string | null;
  initiatorActorType: string | null;
  initiatorActorDisplayName: string | null;
  correlationId: string | null;
  requestPath: string | null;
  targetNodeCount: number;
  completedNodeCount: number;
  successfulNodeCount: number;
  failedNodeCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ClusterOperationAckRecord = {
  id: string;
  operationId: string;
  nodeInstanceId: string;
  nodeHostname: string | null;
  endpointUrl: string | null;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  ackedAt: Date | null;
  details: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ClusterOperationRecordWithAcks = ClusterOperationRecord & {
  acknowledgements: ClusterOperationAckRecord[];
};

type ClusterOperationSummaryRecord = ClusterOperationRecord & {
  acknowledgements?: ClusterOperationAckRecord[];
};

type OperationTarget = {
  instanceId: string;
  hostname: string;
  ipAddress: string | null;
  metadata: unknown;
};

type OperationExecutionContext = {
  auth?: AuthIdentity;
  correlationId?: string;
  requestPath?: string;
};

type StartClusterOperationOptions<TLocalResult = unknown> = {
  operationType: string;
  remotePath: string;
  remoteMethod?: 'POST';
  remoteQuery?: Record<string, string | undefined>;
  broadcast?: boolean;
  executionTimeoutMs?: number;
  localAction: (operationId: string) => Promise<TLocalResult>;
  initiatedBy?: OperationExecutionContext;
  metadata?: Record<string, unknown>;
};

type WaitForOperationOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type ListClusterOperationsOptions = {
  limit?: number;
  status?: string;
  operationType?: string;
  operationTypes?: string[];
  targetNodeId?: string;
};

export type ClusterOperationAcceptedResponse = {
  operationId: string;
  operationType: string;
  status: string;
  scope: string;
  targetNodeCount: number;
  completedNodeCount: number;
  successfulNodeCount: number;
  failedNodeCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  correlationId: string | null;
  requestPath: string | null;
  operationStatusPath: string;
  links: {
    self: string;
  };
  statusSummary: {
    pendingNodeCount: number;
    completionRatio: number;
    isTerminal: boolean;
    isSuccessful: boolean;
  };
};

@Injectable()
export class ClusterOperationsService {
  private readonly logger = new Logger(ClusterOperationsService.name);
  private readonly defaultExecutionTimeoutMs = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clusterHeartbeat: ClusterHeartbeatService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  async enqueueBroadcastOperation<TLocalResult = unknown>(
    options: StartClusterOperationOptions<TLocalResult>,
  ): Promise<ClusterOperationAcceptedResponse> {
    const targets = await this.resolveTargets(options.broadcast ?? true);
    const createdOperation = await this.prisma.clusterOperation.create({
      data: {
        operationType: options.operationType,
        scope: targets.length > 1 ? 'cluster' : 'node',
        status: 'pending',
        initiatorNodeId: this.distributedLock.getInstanceId(),
        initiatorHostname: os.hostname(),
        initiatorActorId: options.initiatedBy?.auth?.id,
        initiatorActorType: options.initiatedBy?.auth?.actorType,
        initiatorActorDisplayName: options.initiatedBy?.auth?.displayName,
        correlationId: options.initiatedBy?.correlationId ?? null,
        requestPath: options.initiatedBy?.requestPath ?? null,
        targetNodeCount: targets.length,
        metadata: {
          remotePath: options.remotePath,
          remoteMethod: options.remoteMethod ?? 'POST',
          broadcast: options.broadcast ?? true,
          ...(options.metadata ?? {}),
        },
        acknowledgements: {
          create: targets.map((target) => ({
            nodeInstanceId: target.instanceId,
            nodeHostname: target.hostname,
            status: 'pending',
            endpointUrl:
              target.instanceId === this.distributedLock.getInstanceId()
                ? null
                : buildClusterNodeUrl(target, options.remotePath, {
                    ...(options.remoteQuery ?? {}),
                    operationId: '__pending__',
                  }),
          })),
        },
      },
    });

    await Promise.all(
      targets
        .filter((target) => target.instanceId !== this.distributedLock.getInstanceId())
        .map((target) =>
          this.prisma.clusterOperationAck.update({
            where: {
              operationId_nodeInstanceId: {
                operationId: createdOperation.id,
                nodeInstanceId: target.instanceId,
              },
            },
            data: {
              endpointUrl: buildClusterNodeUrl(target, options.remotePath, {
                ...(options.remoteQuery ?? {}),
                operationId: createdOperation.id,
              }),
            },
          }),
        ),
    );

    void runWithLogContext(
      {
        correlationId: options.initiatedBy?.correlationId,
        operationId: createdOperation.id,
      },
      () => this.executeOperation(createdOperation.id, targets, options),
    ).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Operation] Execution failed for ${createdOperation.id}: ${message}`,
      );
      await this.prisma.clusterOperation.update({
        where: { id: createdOperation.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          lastError: this.truncate(message),
        },
      });
    });

    const operation = await this.prisma.clusterOperation.findUniqueOrThrow({
      where: { id: createdOperation.id },
    });

    return this.toAcceptedResponse(operation);
  }

  async listOperations(limitOrOptions: number | ListClusterOperationsOptions = 20) {
    const options =
      typeof limitOrOptions === 'number'
        ? ({ limit: limitOrOptions } satisfies ListClusterOperationsOptions)
        : limitOrOptions;
    const take = this.normalizeListLimit(options.limit ?? 20);
    const operationTypes = this.normalizeOperationTypes(options);
    const targetNodeId = options.targetNodeId?.trim() || undefined;
    const operations = (await this.prisma.clusterOperation.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(operationTypes.length === 1
          ? { operationType: operationTypes[0] }
          : operationTypes.length > 1
            ? { operationType: { in: operationTypes } }
            : {}),
        ...(targetNodeId
          ? {
              acknowledgements: {
                some: {
                  nodeInstanceId: targetNodeId,
                },
              },
            }
          : {}),
      },
      ...(targetNodeId
        ? {
            include: {
              acknowledgements: {
                where: { nodeInstanceId: targetNodeId },
                orderBy: [{ nodeHostname: 'asc' }, { nodeInstanceId: 'asc' }],
              },
            },
          }
        : {}),
    })) as ClusterOperationSummaryRecord[];

    const filteredOperations = targetNodeId
      ? operations.filter((operation) => (operation.acknowledgements?.length ?? 0) > 0)
      : operations;

    return {
      count: filteredOperations.length,
      filters: {
        limit: take,
        status: options.status ?? null,
        operationTypes,
        targetNodeId: targetNodeId ?? null,
      },
      operations: filteredOperations.map((operation) =>
        this.toSummary(operation, operation.acknowledgements?.[0] ?? null),
      ),
    };
  }

  async getOperation(operationId: string) {
    const operation = await this.prisma.clusterOperation.findUnique({
      where: { id: operationId },
      include: {
        acknowledgements: {
          orderBy: [{ nodeHostname: 'asc' }, { nodeInstanceId: 'asc' }],
        },
      },
    });

    if (!operation) {
      return null;
    }

    return this.toDetailedOperation(operation);
  }

  async waitForOperationToSettle(
    operationId: string,
    options: WaitForOperationOptions = {},
  ) {
    const timeoutMs = options.timeoutMs ?? 30000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const operation = await this.getOperation(operationId);

      if (!operation) {
        throw new Error(`Cluster operation not found: ${operationId}`);
      }

      if (!['pending', 'running'].includes(operation.status)) {
        return operation;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timed out waiting for cluster operation ${operationId} to settle after ${timeoutMs}ms`,
    );
  }

  private async executeOperation<TLocalResult>(
    operationId: string,
    targets: OperationTarget[],
    options: StartClusterOperationOptions<TLocalResult>,
  ) {
    await this.prisma.clusterOperation.update({
      where: { id: operationId },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    const localInstanceId = this.distributedLock.getInstanceId();
    const localTarget =
      targets.find((target) => target.instanceId === localInstanceId) ??
      this.buildFallbackLocalTarget();
    const remoteTargets = targets.filter(
      (target) => target.instanceId !== localTarget.instanceId,
    );

    await this.runLocalTarget(operationId, localTarget, options.localAction);

    if (remoteTargets.length > 0) {
      const apiKey = process.env.API_KEY?.split(',')[0]?.trim();

      if (!apiKey) {
        await Promise.all(
          remoteTargets.map((target) =>
            this.markAckFailed(
              operationId,
              target.instanceId,
              'No API key is configured for authenticated peer requests',
            ),
          ),
        );
      } else {
        await Promise.all(
          remoteTargets.map((target) =>
            this.runRemoteTarget(operationId, target, options, apiKey),
          ),
        );
      }
    }

    await this.refreshOperation(operationId);
  }

  private async runLocalTarget<TLocalResult>(
    operationId: string,
    target: OperationTarget,
    localAction: (operationId: string) => Promise<TLocalResult>,
  ) {
    await this.markAckStarted(operationId, target.instanceId);

    try {
      const result = await localAction(operationId);
      await this.markAckSucceeded(operationId, target.instanceId, 200, null, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markAckFailed(operationId, target.instanceId, message);
    }
  }

  private async runRemoteTarget<TLocalResult>(
    operationId: string,
    target: OperationTarget,
    options: StartClusterOperationOptions<TLocalResult>,
    apiKey: string,
  ) {
    const url = buildClusterNodeUrl(target, options.remotePath, {
      ...(options.remoteQuery ?? {}),
      operationId,
    });

    if (!url) {
      await this.markAckFailed(
        operationId,
        target.instanceId,
        'Target node does not have a valid control-plane endpoint',
      );
      return;
    }

    await this.markAckStarted(operationId, target.instanceId, url);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.executionTimeoutMs ?? this.defaultExecutionTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        method: options.remoteMethod ?? 'POST',
        headers: {
          'X-API-Key': apiKey,
          ...(options.initiatedBy?.correlationId
            ? { 'X-Correlation-Id': options.initiatedBy.correlationId }
            : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.markAckFailed(
          operationId,
          target.instanceId,
          await this.readRemoteError(response),
          response.status,
          url,
        );
        return;
      }

      const details = await this.readRemoteSuccess(response);

      await this.markAckSucceeded(
        operationId,
        target.instanceId,
        response.status,
        url,
        details,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markAckFailed(
        operationId,
        target.instanceId,
        message,
        null,
        url,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async resolveTargets(includeRemoteNodes: boolean) {
    const localInstanceId = this.distributedLock.getInstanceId();
    const activeNodes = await this.clusterHeartbeat
      .getActiveNodes()
      .catch((error) => {
        this.logger.warn(
          `[Operation] Failed to read active cluster nodes, falling back to the local node only: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [] as ClusterNodeTarget[];
      });

    const targets = new Map<string, OperationTarget>();

    for (const node of activeNodes) {
      if (node.instanceId === localInstanceId || includeRemoteNodes) {
        targets.set(node.instanceId, {
          instanceId: node.instanceId,
          hostname: node.hostname,
          ipAddress: node.ipAddress,
          metadata: node.metadata,
        });
      }
    }

    if (!targets.has(localInstanceId)) {
      const localTarget = this.buildFallbackLocalTarget();
      targets.set(localTarget.instanceId, localTarget);
    }

    if (!includeRemoteNodes) {
      return [targets.get(localInstanceId)!];
    }

    return Array.from(targets.values());
  }

  private buildFallbackLocalTarget(): OperationTarget {
    return {
      instanceId: this.distributedLock.getInstanceId(),
      hostname: os.hostname(),
      ipAddress: null,
      metadata: null,
    };
  }

  private async markAckStarted(
    operationId: string,
    nodeInstanceId: string,
    endpointUrl?: string | null,
  ) {
    await this.prisma.clusterOperationAck.update({
      where: {
        operationId_nodeInstanceId: {
          operationId,
          nodeInstanceId,
        },
      },
      data: {
        status: 'running',
        startedAt: new Date(),
        ...(endpointUrl === undefined ? {} : { endpointUrl }),
      },
    });
  }

  private async markAckSucceeded(
    operationId: string,
    nodeInstanceId: string,
    responseStatus: number,
    endpointUrl?: string | null,
    details?: unknown,
  ) {
    await this.prisma.clusterOperationAck.update({
      where: {
        operationId_nodeInstanceId: {
          operationId,
          nodeInstanceId,
        },
      },
      data: {
        status: 'succeeded',
        responseStatus,
        errorMessage: null,
        ackedAt: new Date(),
        details:
          details === undefined
            ? undefined
            : this.normalizeAckDetails(details),
        ...(endpointUrl === undefined ? {} : { endpointUrl }),
      },
    });
  }

  private async markAckFailed(
    operationId: string,
    nodeInstanceId: string,
    errorMessage: string,
    responseStatus?: number | null,
    endpointUrl?: string | null,
  ) {
    await this.prisma.clusterOperationAck.update({
      where: {
        operationId_nodeInstanceId: {
          operationId,
          nodeInstanceId,
        },
      },
      data: {
        status: 'failed',
        responseStatus: responseStatus ?? null,
        errorMessage: this.truncate(errorMessage),
        ackedAt: new Date(),
        ...(endpointUrl === undefined ? {} : { endpointUrl }),
      },
    });
  }

  private async refreshOperation(operationId: string) {
    const acknowledgements = await this.prisma.clusterOperationAck.findMany({
      where: { operationId },
      select: {
        status: true,
        errorMessage: true,
      },
    });

    const completedNodeCount = acknowledgements.filter((ack) =>
      ['succeeded', 'failed'].includes(ack.status),
    ).length;
    const successfulNodeCount = acknowledgements.filter(
      (ack) => ack.status === 'succeeded',
    ).length;
    const failedNodeCount = acknowledgements.filter(
      (ack) => ack.status === 'failed',
    ).length;
    const latestError = acknowledgements.find((ack) => ack.errorMessage)?.errorMessage;
    const status = this.calculateOperationStatus(
      acknowledgements.length,
      completedNodeCount,
      successfulNodeCount,
      failedNodeCount,
    );

    await this.prisma.clusterOperation.update({
      where: { id: operationId },
      data: {
        status,
        completedNodeCount,
        successfulNodeCount,
        failedNodeCount,
        completedAt:
          completedNodeCount === acknowledgements.length ? new Date() : null,
        lastError: latestError ?? null,
      },
    });
  }

  private calculateOperationStatus(
    targetNodeCount: number,
    completedNodeCount: number,
    successfulNodeCount: number,
    failedNodeCount: number,
  ) {
    if (targetNodeCount === 0) {
      return 'succeeded';
    }

    if (completedNodeCount === 0) {
      return 'pending';
    }

    if (completedNodeCount < targetNodeCount) {
      return 'running';
    }

    if (failedNodeCount === 0) {
      return 'succeeded';
    }

    if (successfulNodeCount === 0) {
      return 'failed';
    }

    return 'partially_failed';
  }

  private async readRemoteError(response: Response) {
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as Record<string, unknown>;
        const message = payload['message'];
        if (typeof message === 'string' && message.trim()) {
          return this.truncate(message);
        }
        return this.truncate(JSON.stringify(payload));
      }

      const text = await response.text();
      return this.truncate(text || response.statusText);
    } catch (error) {
      return this.truncate(
        error instanceof Error ? error.message : response.statusText,
      );
    }
  }

  private async readRemoteSuccess(response: Response) {
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as Record<string, unknown>;
      }

      const text = await response.text();
      return text.trim().length > 0 ? { message: text } : null;
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : response.statusText,
      };
    }
  }

  private normalizeAckDetails(details: unknown) {
    if (details === undefined) {
      return undefined;
    }

    return toPrismaNullableJsonValue(details);
  }

  private toAcceptedResponse(
    operation: ClusterOperationRecord,
  ): ClusterOperationAcceptedResponse {
    return {
      operationId: operation.id,
      operationType: operation.operationType,
      status: operation.status,
      scope: operation.scope,
      targetNodeCount: operation.targetNodeCount,
      completedNodeCount: operation.completedNodeCount,
      successfulNodeCount: operation.successfulNodeCount,
      failedNodeCount: operation.failedNodeCount,
      createdAt: operation.createdAt,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      correlationId: operation.correlationId,
      requestPath: operation.requestPath,
      operationStatusPath: `/cluster/operations/${operation.id}`,
      links: {
        self: `/cluster/operations/${operation.id}`,
      },
      statusSummary: this.buildStatusSummary(operation),
    };
  }

  private toSummary(
    operation: ClusterOperationRecord,
    nodeAcknowledgement?: ClusterOperationAckRecord | null,
  ) {
    return {
      operationId: operation.id,
      operationType: operation.operationType,
      scope: operation.scope,
      status: operation.status,
      targetNodeCount: operation.targetNodeCount,
      completedNodeCount: operation.completedNodeCount,
      successfulNodeCount: operation.successfulNodeCount,
      failedNodeCount: operation.failedNodeCount,
      initiatorNodeId: operation.initiatorNodeId,
      initiatorHostname: operation.initiatorHostname,
      correlationId: operation.correlationId,
      requestPath: operation.requestPath,
      createdAt: operation.createdAt,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      lastError: operation.lastError,
      operationStatusPath: `/cluster/operations/${operation.id}`,
      links: {
        self: `/cluster/operations/${operation.id}`,
      },
      statusSummary: this.buildStatusSummary(operation),
      nodeAcknowledgement: nodeAcknowledgement
        ? {
            nodeInstanceId: nodeAcknowledgement.nodeInstanceId,
            nodeHostname: nodeAcknowledgement.nodeHostname,
            endpointUrl: nodeAcknowledgement.endpointUrl,
            status: nodeAcknowledgement.status,
            responseStatus: nodeAcknowledgement.responseStatus,
            errorMessage: nodeAcknowledgement.errorMessage,
            startedAt: nodeAcknowledgement.startedAt,
            ackedAt: nodeAcknowledgement.ackedAt,
            details: nodeAcknowledgement.details,
          }
        : null,
    };
  }

  private toDetailedOperation(operation: ClusterOperationRecordWithAcks) {
    return {
      ...this.toSummary(operation),
      metadata: operation.metadata,
      acknowledgements: operation.acknowledgements.map((ack) => ({
        nodeInstanceId: ack.nodeInstanceId,
        nodeHostname: ack.nodeHostname,
        endpointUrl: ack.endpointUrl,
        status: ack.status,
        responseStatus: ack.responseStatus,
        errorMessage: ack.errorMessage,
        startedAt: ack.startedAt,
        ackedAt: ack.ackedAt,
        details: ack.details,
        createdAt: ack.createdAt,
        updatedAt: ack.updatedAt,
      })),
    };
  }

  private buildStatusSummary(operation: Pick<
    ClusterOperationRecord,
    | 'status'
    | 'targetNodeCount'
    | 'completedNodeCount'
    | 'successfulNodeCount'
    | 'failedNodeCount'
  >) {
    const pendingNodeCount = Math.max(
      operation.targetNodeCount - operation.completedNodeCount,
      0,
    );

    return {
      pendingNodeCount,
      completionRatio:
        operation.targetNodeCount > 0
          ? Number(
              (operation.completedNodeCount / operation.targetNodeCount).toFixed(4),
            )
          : 1,
      isTerminal: !['pending', 'running'].includes(operation.status),
      isSuccessful: operation.status === 'succeeded',
    };
  }

  private normalizeOperationTypes(options: ListClusterOperationsOptions) {
    const values = [
      ...(Array.isArray(options.operationTypes) ? options.operationTypes : []),
      ...(options.operationType ? [options.operationType] : []),
    ]
      .map((value) => value.trim())
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

    return values;
  }

  private normalizeListLimit(limit: number) {
    if (!Number.isFinite(limit) || limit <= 0) {
      return 20;
    }

    return Math.min(Math.floor(limit), 100);
  }

  private truncate(value: string, maxLength = 500) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  }
}

