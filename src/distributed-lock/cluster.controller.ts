import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import * as os from 'os';
import { Response } from 'express';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { ClusterOperationsService } from './cluster-operations.service';
import { DistributedLockService } from './distributed-lock.service';
import { ReloaderService } from '../reloader/reloader.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthorizeAdmin,
  AuthorizeInternalNodeOrAdmin,
} from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  getClusterNodeControlPlaneEndpoint,
} from '../utils/network-utils';
import { Audit } from '../audit/decorators/audit.decorator';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { parseDomains } from '../utils/domain-utils';

@Controller('cluster')
@UseGuards(ApiKeyGuard)
@AuthorizeAdmin('viewer')
export class ClusterController {
  private readonly logger = new Logger(ClusterController.name);

  constructor(
    private readonly clusterHeartbeat: ClusterHeartbeatService,
    private readonly clusterOperations: ClusterOperationsService,
    private readonly distributedLock: DistributedLockService,
    private readonly reloader: ReloaderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async getStatus(@Query('operationLimit') operationLimit?: string) {
    const [stats, leaderStatus, nodes, operations] = await Promise.all([
      this.clusterHeartbeat.getClusterStats(),
      this.getLeaderStatus(),
      this.getNodes(),
      this.clusterOperations.listOperations({
        limit: this.parseLimit(operationLimit, 10),
      }),
    ]);

    return {
      status: leaderStatus.status === 'healthy' ? 'ok' : 'attention',
      generatedAt: new Date().toISOString(),
      cluster: stats,
      leader: leaderStatus,
      nodes,
      operations,
      links: {
        nodes: '/cluster/nodes',
        leader: '/cluster/leader',
        lease: '/cluster/lease',
        operations: '/cluster/operations',
      },
    };
  }

  /**
   * Trigger a reload on this node and optionally broadcast to others
   */
  @Post('reload')
  @AuthorizeInternalNodeOrAdmin('operator')
  @Audit({ action: 'cluster.reload' })
  async reload(
    @Query('broadcast') broadcast: string,
    @Query('operationId') operationId: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (operationId) {
      const localResult = await this.reloader.reloadConfig();

      if (!localResult.ok) {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR);
        return {
          operationId,
          status: 'failed',
          node: this.getLocalNodeInfo(),
          error: localResult.error ?? 'Reload failed',
        };
      }

      return {
        operationId,
        status: 'succeeded',
        node: this.getLocalNodeInfo(),
        runtime: await this.safeReadLocalRuntimeReleaseStatus(),
      };
    }

    const shouldBroadcast = broadcast !== 'false';
    this.logger.log(`[Reload] Queued. Broadcast: ${shouldBroadcast}`);

    const operation = await this.clusterOperations.enqueueBroadcastOperation({
      operationType: 'cluster.reload',
      broadcast: shouldBroadcast,
      remotePath: '/cluster/reload',
      remoteQuery: { broadcast: 'false' },
      initiatedBy: {
        auth: request.auth,
        correlationId: request.auditContext?.correlationId,
        requestPath: request.originalUrl ?? request.url ?? '/cluster/reload',
      },
      metadata: {
        broadcast: shouldBroadcast,
      },
      localAction: async () => {
        const localResult = await this.reloader.reloadConfig();
        if (!localResult.ok) {
          throw new Error(localResult.error ?? 'Reload failed');
        }
        return {
          ...localResult,
          runtime: await this.safeReadLocalRuntimeReleaseStatus(),
        };
      },
    });

    response.status(HttpStatus.ACCEPTED);
    return operation;
  }

  @Get('operations')
  async getOperations(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') operationType?: string,
    @Query('nodeId') nodeId?: string,
  ) {
    const resolvedNode = nodeId ? await this.findNodeRecord(nodeId) : null;

    if (nodeId && !resolvedNode) {
      return {
        count: 0,
        filters: {
          requestedNodeId: nodeId,
          resolvedNodeId: null,
          found: false,
          status: status ?? null,
          operationTypes: operationType ? [operationType] : [],
        },
        operations: [],
      };
    }

    const operations = await this.clusterOperations.listOperations({
      limit: this.parseLimit(limit, 20),
      status,
      operationType,
      targetNodeId: resolvedNode?.instanceId,
    });

    return {
      ...operations,
      filters: {
        ...operations.filters,
        requestedNodeId: nodeId ?? null,
        resolvedNodeId: resolvedNode?.instanceId ?? null,
      },
    };
  }

  @Get('operations/:operationId')
  async getOperation(@Param('operationId') operationId: string) {
    const operation = await this.clusterOperations.getOperation(operationId);

    if (!operation) {
      return {
        operationId,
        found: false,
        message: 'Cluster operation not found',
      };
    }

    return {
      found: true,
      ...operation,
    };
  }

  /**
   * Get all active cluster nodes
   */
  @Get('nodes')
  async getNodes(@Query('includeInactive') includeInactive?: string) {
    const nodes = await this.listNodes(includeInactive === 'true');
    return {
      count: nodes.length,
      includeInactive: includeInactive === 'true',
      nodes: nodes.map((node) => this.toNodeSummary(node)),
    };
  }

  @Get('nodes/:nodeId/config')
  async getNodeConfig(@Param('nodeId') nodeId: string) {
    const node = await this.findNodeRecord(nodeId);

    if (!node) {
      return {
        found: false,
        nodeId,
        message: 'Cluster node not found',
      };
    }

    return {
      found: true,
      node: this.toNodeSummary(node),
      config: await this.buildNodeConfigState(node),
    };
  }

  @Get('nodes/:nodeId/certificates')
  async getNodeCertificates(@Param('nodeId') nodeId: string) {
    const node = await this.findNodeRecord(nodeId);

    if (!node) {
      return {
        found: false,
        nodeId,
        message: 'Cluster node not found',
      };
    }

    return {
      found: true,
      node: this.toNodeSummary(node),
      certificates: await this.buildNodeCertificateState(node),
    };
  }

  @Get('nodes/:nodeId')
  async getNode(@Param('nodeId') nodeId: string) {
    const node = await this.findNodeRecord(nodeId);

    if (!node) {
      return {
        found: false,
        nodeId,
        message: 'Cluster node not found',
      };
    }

    const [config, certificates, operations] = await Promise.all([
      this.buildNodeConfigState(node),
      this.buildNodeCertificateState(node),
      this.clusterOperations.listOperations({
        limit: 10,
        targetNodeId: node.instanceId,
      }),
    ]);

    return {
      found: true,
      node: this.toNodeSummary(node),
      config,
      certificates,
      operations,
      links: {
        self: `/cluster/nodes/${node.instanceId}`,
        config: `/cluster/nodes/${node.instanceId}/config`,
        certificates: `/cluster/nodes/${node.instanceId}/certificates`,
        operations: `/cluster/operations?nodeId=${encodeURIComponent(node.instanceId)}`,
      },
    };
  }

  /**
   * Get cluster statistics
   */
  @Get('stats')
  async getStats() {
    return this.clusterHeartbeat.getClusterStats();
  }

  /**
   * Get the current leader node
   */
  @Get('leader')
  async getLeader() {
    const leader = await this.clusterHeartbeat.getLeaderNode();
    if (!leader) {
      return { leader: null, message: 'No active leader found' };
    }
    return {
      leader: {
        id: leader.id,
        hostname: leader.hostname,
        instanceId: leader.instanceId,
        ipAddress: leader.ipAddress,
        controlPlane: getClusterNodeControlPlaneEndpoint(leader),
        lastHeartbeat: leader.lastHeartbeat,
        version: leader.version,
        metadata: leader.metadata,
      },
    };
  }

  /**
   * Get comprehensive leader status including lock state
   */
  @Get('leader/status')
  async getLeaderStatus() {
    const leaderState = await this.clusterHeartbeat.getLeaderLeaseState();
    const dbLeader = leaderState.activeLeaderNode;
    const lockStatus = this.distributedLock.getLeaderLockStatus();
    const lease = leaderState.lease;
    const allLeaders = dbLeader ? [dbLeader] : [];

    const hasActiveLease = leaderState.hasActiveLease;
    const dbMatchesLease = Boolean(
      dbLeader && hasActiveLease && lease?.ownerNodeId === dbLeader.instanceId,
    );
    const issues = [
      ...leaderState.issues,
      !hasActiveLease && 'NO_ACTIVE_LEASE',
      hasActiveLease && !dbLeader && 'LEASE_WITHOUT_ACTIVE_NODE',
      hasActiveLease && dbLeader && !dbMatchesLease && 'LEASE_DB_MISMATCH',
      lockStatus.isLeader &&
        lease &&
        lockStatus.generation !== lease.generation &&
        'LOCAL_LEASE_STALE',
      lockStatus.isLeader &&
        lease?.ownerNodeId &&
        lockStatus.ownerNodeId !== lease.ownerNodeId &&
        'LOCAL_OWNER_MISMATCH',
    ].filter(Boolean);
    const isConsistent =
      issues.length === 0 && hasActiveLease && dbMatchesLease;

    return {
      status: isConsistent
        ? 'healthy'
        : hasActiveLease
          ? 'degraded'
          : 'no-leader',
      lease: lease
        ? {
            leaseName: lease.leaseName,
            ownerNodeId: lease.ownerNodeId,
            ownerHostname: lease.ownerHostname,
            generation: lease.generation,
            fencingToken: lease.fencingToken,
            ttlSeconds: lease.ttlSeconds,
            acquiredAt: lease.acquiredAt,
            renewedAt: lease.renewedAt,
            expiresAt: lease.expiresAt,
            isExpired: lease.isExpired,
            isHeldByThisInstance: lease.isHeldByThisInstance,
          }
        : null,
      lockHolder: lockStatus.isLeader
        ? {
            instanceId: lockStatus.ownerNodeId ?? lockStatus.instanceId,
            heldForMs: lockStatus.heldForMs,
            generation: lockStatus.generation,
            fencingToken: lockStatus.fencingToken,
            expiresAt: lockStatus.expiresAt,
          }
        : null,
      leaseOwnerRecord: leaderState.ownerNode
        ? {
            hostname: leaderState.ownerNode.hostname,
            instanceId: leaderState.ownerNode.instanceId,
            ipAddress: leaderState.ownerNode.ipAddress,
            controlPlane: getClusterNodeControlPlaneEndpoint(
              leaderState.ownerNode,
            ),
            status: leaderState.ownerNode.status,
            lastHeartbeat: leaderState.ownerNode.lastHeartbeat,
          }
        : null,
      dbLeader: dbLeader
        ? {
            hostname: dbLeader.hostname,
            instanceId: dbLeader.instanceId,
            ipAddress: dbLeader.ipAddress,
            controlPlane: getClusterNodeControlPlaneEndpoint(dbLeader),
            lastHeartbeat: dbLeader.lastHeartbeat,
            status: dbLeader.status,
          }
        : null,
      allLeadersInDb: allLeaders.map((l) => ({
        hostname: l.hostname,
        instanceId: l.instanceId,
        ipAddress: l.ipAddress,
        controlPlane: getClusterNodeControlPlaneEndpoint(l),
        status: l.status,
        lastHeartbeat: l.lastHeartbeat,
      })),
      issues,
    };
  }

  /**
   * Get the current leader lease and fencing-token state.
   */
  @Get('lease')
  async getLease() {
    const lease = await this.distributedLock.getLeaderLeaseSnapshot();
    return {
      lease,
      local: this.distributedLock.getLeaderLockStatus(),
    };
  }

  /**
   * Manually trigger cleanup of stale nodes
   */
  @Get('admin/cleanup')
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'cluster.cleanup' })
  async manualCleanup() {
    return this.clusterHeartbeat.manualCleanup();
  }

  /**
   * Manually enforce single leader (fixes split-brain)
   */
  @Get('admin/enforce-leader')
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'cluster.enforce-leader' })
  async manualEnforceLeader() {
    return this.clusterHeartbeat.manualEnforceLeader();
  }

  /**
   * Check and ensure leader exists (auto-elects if needed)
   */
  @Get('admin/ensure-leader')
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'cluster.ensure-leader' })
  async ensureLeader() {
    try {
      await this.clusterHeartbeat.ensureLeaderExists();
      const leader = await this.clusterHeartbeat.getLeaderNode();
      return {
        success: true,
        message: leader
          ? `Leader exists: ${leader.hostname}`
          : 'Leader check completed',
        leader: leader
          ? {
              hostname: leader.hostname,
              instanceId: leader.instanceId,
              lastHeartbeat: leader.lastHeartbeat,
            }
          : null,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to ensure leader: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Try to make this node the leader
   */
  @Get('admin/become-leader')
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'cluster.become-leader' })
  async tryBecomeLeader() {
    try {
      const success = await this.clusterHeartbeat.tryBecomeLeader();
      return {
        success,
        message: success
          ? 'This node is now the leader'
          : 'Failed to become leader (lock held by another node)',
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private getLocalNodeInfo() {
    return {
      instanceId: this.distributedLock.getInstanceId(),
      hostname: os.hostname(),
    };
  }

  private async listNodes(includeInactive: boolean) {
    if (!includeInactive) {
      return this.clusterHeartbeat.getActiveNodes();
    }

    return this.prisma.clusterNode.findMany({
      orderBy: [{ status: 'asc' }, { lastHeartbeat: 'desc' }],
    });
  }

  private async findNodeRecord(nodeId: string) {
    const trimmed = nodeId.trim();

    if (!trimmed) {
      return null;
    }

    return this.prisma.clusterNode.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { instanceId: trimmed },
          { hostname: trimmed },
        ],
      },
    });
  }

  private toNodeSummary(node: {
    id: string;
    hostname: string;
    instanceId: string;
    ipAddress: string | null;
    isLeader: boolean;
    status: string;
    lastHeartbeat: Date;
    version: string | null;
    metadata: unknown;
  }) {
    return {
      id: node.id,
      hostname: node.hostname,
      instanceId: node.instanceId,
      ipAddress: node.ipAddress,
      controlPlane: getClusterNodeControlPlaneEndpoint(node),
      isLeader: node.isLeader,
      status: node.status,
      lastHeartbeat: node.lastHeartbeat,
      version: node.version,
      metadata: node.metadata,
      isLocal: node.instanceId === this.distributedLock.getInstanceId(),
    };
  }

  private async buildNodeConfigState(node: {
    instanceId: string;
    hostname: string;
  }) {
    const operations = await this.clusterOperations.listOperations({
      limit: 5,
      targetNodeId: node.instanceId,
      operationType: 'cluster.reload',
    });
    const latestReload = operations.operations[0] ?? null;

    return {
      nodeInstanceId: node.instanceId,
      source:
        node.instanceId === this.distributedLock.getInstanceId()
          ? ['operation-journal', 'local-runtime']
          : ['operation-journal'],
      latestReload,
      runtime:
        node.instanceId === this.distributedLock.getInstanceId()
          ? await this.safeReadLocalRuntimeReleaseStatus()
          : null,
    };
  }

  private async buildNodeCertificateState(node: {
    instanceId: string;
  }) {
    const operations = await this.clusterOperations.listOperations({
      limit: 10,
      targetNodeId: node.instanceId,
      operationTypes: [
        'certificate.activate',
        'certificate.rollback',
        'certificate.sync',
      ],
    });
    const latestActivation =
      operations.operations.find((operation) =>
        ['certificate.activate', 'certificate.rollback'].includes(
          operation.operationType,
        ),
      ) ?? null;
    const latestSync =
      operations.operations.find(
        (operation) => operation.operationType === 'certificate.sync',
      ) ?? null;

    return {
      nodeInstanceId: node.instanceId,
      source:
        node.instanceId === this.distributedLock.getInstanceId()
          ? ['operation-journal', 'cluster-database']
          : ['operation-journal'],
      latestActivation,
      latestSync,
      activeCertificates:
        node.instanceId === this.distributedLock.getInstanceId()
          ? await this.readLocalCertificateInventory()
          : null,
    };
  }

  private async safeReadLocalRuntimeReleaseStatus() {
    try {
      return await this.reloader.getRuntimeReleaseStatus();
    } catch (error) {
      return {
        readError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readLocalCertificateInventory() {
    try {
      const [count, certificates] = await Promise.all([
        this.prisma.certificate.count(),
        this.prisma.certificate.findMany({
          take: 5,
          orderBy: { expiresAt: 'asc' },
        }),
      ]);

      const now = Date.now();

      return {
        count,
        nextExpiryAt: certificates[0]?.expiresAt ?? null,
        certificates: certificates.map((certificate) => {
          const daysUntilExpiry = Math.ceil(
            (certificate.expiresAt.getTime() - now) / (1000 * 60 * 60 * 24),
          );

          return {
            id: certificate.id,
            domains: parseDomains(certificate.domains, { allowWildcard: true }),
            expiresAt: certificate.expiresAt,
            issuedAt: certificate.issuedAt,
            lastUsedAt: certificate.lastUsedAt,
            status:
              daysUntilExpiry < 0
                ? 'expired'
                : daysUntilExpiry <= 30
                  ? 'expiring_soon'
                  : 'valid',
            daysUntilExpiry,
          };
        }),
      };
    } catch (error) {
      return {
        count: 0,
        nextExpiryAt: null,
        certificates: [],
        readError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseLimit(value: string | undefined, fallback: number) {
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
