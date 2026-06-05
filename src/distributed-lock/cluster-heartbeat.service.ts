import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from './distributed-lock.service';
import * as os from 'os';
import { getLocalControlPlaneRegistration } from '../utils/network-utils';

type ClusterNodeRecord = {
  id: string;
  hostname: string;
  instanceId: string;
  ipAddress: string | null;
  isLeader: boolean;
  lastHeartbeat: Date;
  version: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type LeaderLeaseSnapshot = Awaited<
  ReturnType<DistributedLockService['getLeaderLeaseSnapshot']>
>;

type LeaderLeaseState = {
  lease: NonNullable<LeaderLeaseSnapshot> | null;
  hasActiveLease: boolean;
  ownerNode: ClusterNodeRecord | null;
  activeLeaderNode: ClusterNodeRecord | null;
  issues: string[];
};

/**
 * Service to track cluster nodes and their health status
 * Helps with monitoring and debugging in distributed deployments
 */
@Injectable()
export class ClusterHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterHeartbeatService.name);
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private leaderCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatIntervalMs = 10000; // 10 seconds
  private readonly staleThresholdMs = 45000; // 45 seconds
  private readonly deleteThresholdMs = 3600000; // 1 hour - delete very old stale nodes
  private readonly leaderCheckIntervalMs = 10000; // 10 seconds - check for leader MORE frequently

  constructor(
    private prisma: PrismaService,
    private distributedLock: DistributedLockService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('[Init] Starting cluster heartbeat service');

      // Register this node first (quick)
      await this.registerNode();

      // CRITICAL: Clean up any stale nodes/leaders in background
      // This fixes issues from previous crashes without blocking startup
      this.cleanupStaleNodes()
        .then(() => this.logger.log('[Init] Startup cleanup completed'))
        .catch((err) =>
          this.logger.error(`[Init] Startup cleanup failed: ${err.message}`),
        );

      // Start heartbeat interval
      this.heartbeatInterval = setInterval(
        () =>
          this.sendHeartbeat().catch((err) =>
            this.logger.error(`[Heartbeat] Interval error: ${err.message}`),
          ),
        this.heartbeatIntervalMs,
      );

      // Start cleanup of stale nodes - run more frequently to catch issues faster
      this.cleanupInterval = setInterval(
        () =>
          this.cleanupStaleNodes().catch((err) =>
            this.logger.error(`[Cleanup] Interval error: ${err.message}`),
          ),
        45000,
      ); // Every 45 seconds - between heartbeat intervals

      // Start leader check - ensures there's always exactly one leader
      this.leaderCheckInterval = setInterval(
        () =>
          this.ensureLeaderExists().catch((err) =>
            this.logger.error(`[LeaderCheck] Interval error: ${err.message}`),
          ),
        this.leaderCheckIntervalMs,
      );

      // AGGRESSIVE initial leader checks to ensure leader exists ASAP
      // Multiple checks in first minute to handle race conditions
      setTimeout(() => {
        this.ensureLeaderExists().catch((err) =>
          this.logger.error(
            `[LeaderCheck] Initial check (1) failed: ${err.message}`,
          ),
        );
      }, 2000); // 2 seconds after startup

      setTimeout(() => {
        this.ensureLeaderExists().catch((err) =>
          this.logger.error(
            `[LeaderCheck] Initial check (2) failed: ${err.message}`,
          ),
        );
      }, 7000); // 7 seconds after startup

      setTimeout(() => {
        this.ensureLeaderExists().catch((err) =>
          this.logger.error(
            `[LeaderCheck] Initial check (3) failed: ${err.message}`,
          ),
        );
      }, 15000); // 15 seconds after startup
    } catch (error) {
      this.logger.error(
        `[Init] Failed to initialize cluster heartbeat: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - allow app to continue without cluster tracking
    }
  }

  async onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
    }

    // Mark node as inactive
    await this.unregisterNode();
  }

  /**
   * Register this node in the cluster
   */
  private async registerNode() {
    const instanceId = this.distributedLock.getInstanceId();
    const hostname = os.hostname();
    const controlPlane = getLocalControlPlaneRegistration();
    const ipAddress = controlPlane.endpoint?.address ?? null;

    if (!controlPlane.endpoint) {
      this.logger.warn(
        `[Register] Node ${hostname} does not have a valid control-plane endpoint configured: ${controlPlane.issues.join('; ')}`,
      );
    } else if (controlPlane.issues.length > 0) {
      this.logger.warn(
        `[Register] Node ${hostname} control-plane configuration warnings: ${controlPlane.issues.join('; ')}`,
      );
    }

    try {
      await this.prisma.clusterNode.upsert({
        where: { instanceId },
        create: {
          instanceId,
          hostname,
          ipAddress,
          lastHeartbeat: new Date(),
          status: 'active',
          version: process.env.npm_package_version || 'unknown',
          metadata: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            controlPlane: this.serializeControlPlaneRegistration(controlPlane),
          },
        },
        update: {
          hostname,
          ipAddress,
          lastHeartbeat: new Date(),
          status: 'active',
          version: process.env.npm_package_version || 'unknown',
          metadata: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            controlPlane: this.serializeControlPlaneRegistration(controlPlane),
          },
        },
      });

      this.logger.log(
        `[Register] Node registered: ${hostname} (${instanceId}) at ${ipAddress || 'unknown IP'}`,
      );
    } catch (error) {
      this.logger.error(
        `[Register] Failed to register node: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Send periodic heartbeat
   */
  private async sendHeartbeat() {
    const instanceId = this.distributedLock.getInstanceId();
    const controlPlane = getLocalControlPlaneRegistration();
    const ipAddress = controlPlane.endpoint?.address ?? null;

    try {
      const leaderState = await this.getLeaderLeaseState();
      const finalLeaderStatus =
        leaderState.hasActiveLease &&
        leaderState.lease?.ownerNodeId === instanceId;

      await this.prisma.clusterNode.update({
        where: { instanceId },
        data: {
          lastHeartbeat: new Date(),
          ipAddress,
          isLeader: finalLeaderStatus,
          status: 'active',
          metadata: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime(),
            loadAverage: os.loadavg(),
            controlPlane: this.serializeControlPlaneRegistration(controlPlane),
          },
        },
      });

      if (finalLeaderStatus || leaderState.issues.length > 0) {
        await this.enforceOneLeader();
      }

      this.logger.debug(`[Heartbeat] Sent (Leader: ${finalLeaderStatus})`);
    } catch (error) {
      this.logger.error(
        `[Heartbeat] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Mark node as inactive
   */
  private async unregisterNode() {
    const instanceId = this.distributedLock.getInstanceId();

    try {
      // Release leader lock if held
      const isLeader = await this.distributedLock.isLeader();
      if (isLeader) {
        this.logger.log('[Unregister] Releasing leader lock before shutdown');
        await this.distributedLock.releaseLeaderLock();
      }

      await this.prisma.clusterNode.update({
        where: { instanceId },
        data: {
          status: 'inactive',
          isLeader: false, // Explicitly set to false
          lastHeartbeat: new Date(),
        },
      });

      this.logger.log('[Unregister] Node marked as inactive');
    } catch (error) {
      this.logger.error(
        `[Unregister] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Clean up stale nodes that haven't sent heartbeat recently
   * CRITICAL: Also removes leader status from stale nodes to prevent multiple leaders
   */
  private async cleanupStaleNodes() {
    try {
      const staleThreshold = new Date(Date.now() - this.staleThresholdMs);

      // Find stale nodes first to log properly
      const staleNodes = await this.prisma.clusterNode.findMany({
        where: {
          lastHeartbeat: { lt: staleThreshold },
          status: 'active',
        },
        select: {
          instanceId: true,
          hostname: true,
          isLeader: true,
        },
      });

      if (staleNodes.length > 0) {
        // Mark stale nodes as inactive and remove leader status
        const result = await this.prisma.clusterNode.updateMany({
          where: {
            lastHeartbeat: { lt: staleThreshold },
            status: 'active',
          },
          data: {
            status: 'stale',
            isLeader: false, // CRITICAL: Remove leader status from stale nodes
          },
        });

        const leaderState = await this.getLeaderLeaseState();
        const staleLeaseOwners = staleNodes.filter(
          (node) =>
            leaderState.hasActiveLease &&
            leaderState.lease?.ownerNodeId === node.instanceId,
        );

        if (staleLeaseOwners.length > 0) {
          this.logger.warn(
            `[Cleanup] Active leader lease currently belongs to stale node(s): ${staleLeaseOwners.map((n) => n.hostname).join(', ')}. Waiting for lease expiry before electing a replacement.`,
          );
        }

        this.logger.warn(
          `[Cleanup] Marked ${result.count} stale node(s) as inactive`,
        );
      }

      // Reconcile denormalized leader flags from the authoritative lease state.
      await this.enforceOneLeader();

      // Delete very old stale/inactive nodes to prevent database bloat
      await this.deleteOldNodes();
    } catch (error) {
      this.logger.error(
        `[Cleanup] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete very old stale or inactive nodes
   */
  private async deleteOldNodes() {
    try {
      const deleteThreshold = new Date(Date.now() - this.deleteThresholdMs);

      const result = await this.prisma.clusterNode.deleteMany({
        where: {
          lastHeartbeat: { lt: deleteThreshold },
          status: { in: ['stale', 'inactive'] },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `[Cleanup] Deleted ${result.count} old node(s) older than 1 hour`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[DeleteOldNodes] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reconcile denormalized ClusterNode leader flags from the authoritative lease.
   * Leader selection is derived from the lease rather than DB heartbeat recency.
   */
  private async enforceOneLeader() {
    try {
      const leaderState = await this.getLeaderLeaseState();
      await this.reconcileLeaderFlagsFromLease(leaderState);

      if (leaderState.hasActiveLease && leaderState.activeLeaderNode) {
        this.logger.debug(
          `[EnforceLeader] Reconciled leader flags to lease owner ${leaderState.activeLeaderNode.hostname} (${leaderState.activeLeaderNode.instanceId}) generation ${leaderState.lease?.generation}`,
        );
      } else if (leaderState.hasActiveLease) {
        this.logger.warn(
          `[EnforceLeader] Lease owner ${leaderState.lease?.ownerNodeId} is not currently active; leader flags were cleared while waiting for lease expiry`,
        );
      } else {
        this.logger.debug(
          '[EnforceLeader] No active leader lease is present; cleared any stale leader flags',
        );
      }
    } catch (error) {
      this.logger.error(
        `[EnforceLeader] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all active cluster nodes
   */
  async getActiveNodes() {
    const [nodes, leaderState] = await Promise.all([
      this.prisma.clusterNode.findMany({
        where: { status: 'active' },
        orderBy: { lastHeartbeat: 'desc' },
      }),
      this.getLeaderLeaseState(),
    ]);

    return this.applyLeaseLeadership(nodes, leaderState);
  }

  /**
   * Get the current leader node
   */
  async getLeaderNode() {
    const leaderState = await this.getLeaderLeaseState();
    return leaderState.activeLeaderNode;
  }

  /**
   * Get cluster statistics
   */
  async getClusterStats() {
    const [total, active, stale, inactive, leaderState] = await Promise.all([
      this.prisma.clusterNode.count(),
      this.prisma.clusterNode.count({ where: { status: 'active' } }),
      this.prisma.clusterNode.count({ where: { status: 'stale' } }),
      this.prisma.clusterNode.count({ where: { status: 'inactive' } }),
      this.getLeaderLeaseState(),
    ]);

    const leaders = leaderState.activeLeaderNode
      ? [leaderState.activeLeaderNode]
      : [];

    return {
      total,
      active,
      stale,
      inactive,
      leaders,
      leaderCount: leaders.length,
      hasMultipleLeaders: false,
      leadershipIssues: leaderState.issues,
      leaderLeaseGeneration: leaderState.lease?.generation ?? null,
      leaderLeaseOwnerNodeId: leaderState.lease?.ownerNodeId ?? null,
    };
  }

  async getLeaderLeaseState() {
    const lease = await this.distributedLock.getLeaderLeaseSnapshot();
    const hasActiveLease = Boolean(
      lease && !lease.isExpired && lease.ownerNodeId,
    );
    const ownerNode = hasActiveLease
      ? await this.prisma.clusterNode.findUnique({
          where: { instanceId: lease!.ownerNodeId! },
        })
      : null;
    const activeLeaderNode =
      ownerNode && ownerNode.status === 'active' ? ownerNode : null;
    const issues: string[] = [];

    if (!lease) {
      issues.push('NO_LEASE');
    } else if (lease.isExpired || !lease.ownerNodeId) {
      issues.push('LEASE_EXPIRED');
    }

    if (hasActiveLease && !ownerNode) {
      issues.push('LEASE_OWNER_MISSING');
    }

    if (ownerNode && ownerNode.status !== 'active') {
      issues.push('LEASE_OWNER_NOT_ACTIVE');
    }

    return {
      lease,
      hasActiveLease,
      ownerNode,
      activeLeaderNode,
      issues,
    } satisfies LeaderLeaseState;
  }

  /**
   * Ensure the cluster has an active leader lease and reconcile the legacy
   * ClusterNode.isLeader flag from that lease for observability.
   */
  async ensureLeaderExists() {
    try {
      const activeNodes = await this.prisma.clusterNode.findMany({
        where: { status: 'active' },
        orderBy: { lastHeartbeat: 'desc' },
      });

      if (activeNodes.length === 0) {
        this.logger.warn('[LeaderCheck] No active nodes in cluster');
        return;
      }

      const leaderState = await this.getLeaderLeaseState();
      const thisInstanceId = this.distributedLock.getInstanceId();
      const localLockStatus = this.distributedLock.getLeaderLockStatus();

      if (
        localLockStatus.isLeader &&
        leaderState.hasActiveLease &&
        leaderState.lease?.ownerNodeId !== thisInstanceId
      ) {
        this.logger.error(
          `[LeaderCheck] Local leader state is stale; releasing local lease tracking because ${leaderState.lease?.ownerNodeId} owns the active leader lease`,
        );
        await this.distributedLock.releaseLeaderLock();
      }

      if (leaderState.hasActiveLease && leaderState.activeLeaderNode) {
        await this.enforceOneLeader();
        this.logger.debug(
          `[LeaderCheck] Leader lease is healthy: ${leaderState.activeLeaderNode.hostname} (generation ${leaderState.lease?.generation})`,
        );
        return;
      }

      if (leaderState.hasActiveLease) {
        await this.enforceOneLeader();
        this.logger.warn(
          `[LeaderCheck] Active leader lease generation ${leaderState.lease?.generation} belongs to ${leaderState.lease?.ownerNodeId}, but that node is not currently active. Waiting for lease expiry before electing a replacement.`,
        );
        return;
      }

      this.logger.warn(
        '[LeaderCheck] No active leader lease exists - initiating lease election',
      );

      const acquired = await this.distributedLock.tryAcquireLeaderLock();

      if (acquired) {
        const currentLease = await this.getLeaderLeaseState();
        await this.enforceOneLeader();

        this.logger.log(
          `[LeaderCheck] ✓ This node successfully became the leader (lease generation ${currentLease.lease?.generation ?? 'unknown'})`,
        );
        return;
      }

      this.logger.debug(
        '[LeaderCheck] Failed to acquire leader lease - another node likely holds it',
      );

      await this.enforceOneLeader();
    } catch (error) {
      this.logger.error(
        `[LeaderCheck] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Force this node to try to become the leader
   * Used for manual intervention or recovery scenarios
   */
  async tryBecomeLeader(): Promise<boolean> {
    try {
      const thisInstanceId = this.distributedLock.getInstanceId();
      const leaderState = await this.getLeaderLeaseState();

      if (
        leaderState.hasActiveLease &&
        leaderState.lease?.ownerNodeId === thisInstanceId
      ) {
        await this.enforceOneLeader();
        this.logger.log('[TryBecomeLeader] This node is already the leader');
        return true;
      }

      if (leaderState.hasActiveLease) {
        this.logger.log(
          `[TryBecomeLeader] ✗ Active leader lease is already owned by ${leaderState.lease?.ownerNodeId}`,
        );
        return false;
      }

      const acquired = await this.distributedLock.acquireLeaderLock();

      if (acquired) {
        this.logger.log('[TryBecomeLeader] ✓ Successfully became the leader');
        await this.enforceOneLeader();

        return true;
      } else {
        this.logger.log(
          '[TryBecomeLeader] ✗ Failed to become leader (lock held by another node)',
        );
        return false;
      }
    } catch (error) {
      this.logger.error(
        `[TryBecomeLeader] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Manually trigger cleanup of stale nodes
   * Useful for debugging and admin actions
   */
  async manualCleanup() {
    this.logger.log('[ManualCleanup] Triggered by admin');
    await this.cleanupStaleNodes();
    return { success: true, message: 'Cleanup completed' };
  }

  /**
   * Manually enforce single leader
   * Useful for debugging and fixing split-brain situations
   */
  async manualEnforceLeader() {
    this.logger.log('[ManualEnforce] Triggered by admin');
    await this.enforceOneLeader();
    const leaderState = await this.getLeaderLeaseState();
    return {
      success: true,
      message: leaderState.activeLeaderNode
        ? `Lease-backed leader reconciliation completed for ${leaderState.activeLeaderNode.hostname}`
        : leaderState.hasActiveLease
          ? 'Lease-backed leader reconciliation completed while waiting for lease owner recovery/expiry'
          : 'Lease-backed leader reconciliation completed with no active leader lease',
    };
  }

  private applyLeaseLeadership(
    nodes: ClusterNodeRecord[],
    leaderState: LeaderLeaseState,
  ): ClusterNodeRecord[] {
    const leaderInstanceId = leaderState.hasActiveLease
      ? (leaderState.lease?.ownerNodeId ?? null)
      : null;

    return nodes.map((node) => ({
      ...node,
      isLeader:
        leaderInstanceId !== null &&
        node.status === 'active' &&
        node.instanceId === leaderInstanceId,
    }));
  }

  private async reconcileLeaderFlagsFromLease(
    leaderState: LeaderLeaseState,
  ): Promise<void> {
    const leaderInstanceId = leaderState.activeLeaderNode?.instanceId ?? null;

    if (leaderInstanceId) {
      await Promise.all([
        this.prisma.clusterNode.updateMany({
          where: {
            instanceId: leaderInstanceId,
            isLeader: false,
          },
          data: { isLeader: true },
        }),
        this.prisma.clusterNode.updateMany({
          where: {
            isLeader: true,
            instanceId: { not: leaderInstanceId },
          },
          data: { isLeader: false },
        }),
      ]);
      return;
    }

    await this.prisma.clusterNode.updateMany({
      where: { isLeader: true },
      data: { isLeader: false },
    });
  }

  private serializeControlPlaneRegistration(
    registration: ReturnType<typeof getLocalControlPlaneRegistration>,
  ) {
    return {
      configured: registration.endpoint !== null,
      address: registration.endpoint?.address ?? null,
      port: registration.endpoint?.port ?? null,
      protocol: registration.endpoint?.protocol ?? null,
      baseUrl: registration.endpoint?.baseUrl ?? null,
      source: registration.endpoint?.source ?? null,
      issues: registration.issues,
    };
  }
}
