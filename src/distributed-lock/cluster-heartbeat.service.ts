import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from './distributed-lock.service';
import * as os from 'os';

/**
 * Service to track cluster nodes and their health status
 * Helps with monitoring and debugging in distributed deployments
 */
@Injectable()
export class ClusterHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterHeartbeatService.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs = 30000; // 30 seconds
  private readonly staleThresholdMs = 120000; // 2 minutes
  private readonly deleteThresholdMs = 3600000; // 1 hour - delete very old stale nodes

  constructor(
    private prisma: PrismaService,
    private distributedLock: DistributedLockService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('[Init] Starting cluster heartbeat service');

      // CRITICAL: Clean up any stale nodes/leaders immediately on startup
      // This fixes issues from previous crashes or improper shutdowns
      await this.cleanupStaleNodes();

      // Register this node
      await this.registerNode();

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

    // Mark node as inactive
    await this.unregisterNode();
  }

  /**
   * Register this node in the cluster
   */
  private async registerNode() {
    const instanceId = this.distributedLock.getInstanceId();
    const hostname = os.hostname();

    try {
      await this.prisma.clusterNode.upsert({
        where: { instanceId },
        create: {
          instanceId,
          hostname,
          lastHeartbeat: new Date(),
          status: 'active',
          version: process.env.npm_package_version || 'unknown',
          metadata: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
          },
        },
        update: {
          hostname,
          lastHeartbeat: new Date(),
          status: 'active',
          version: process.env.npm_package_version || 'unknown',
        },
      });

      this.logger.log(
        `[Register] Node registered: ${hostname} (${instanceId})`,
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

    try {
      const isLeader = await this.distributedLock.isLeader();

      // If claiming to be leader, verify no other active leaders exist first
      if (isLeader) {
        const otherLeaders = await this.prisma.clusterNode.findMany({
          where: {
            isLeader: true,
            instanceId: { not: instanceId },
            status: 'active',
          },
        });

        if (otherLeaders.length > 0) {
          this.logger.error(
            `[Heartbeat] CRITICAL: Detected ${otherLeaders.length} other leader(s): ${otherLeaders.map((n) => n.hostname).join(', ')}. Releasing leadership.`,
          );
          // Release our lock to prevent split-brain
          await this.distributedLock.releaseLeaderLock();
          // Fall through to update as non-leader
        }
      }

      // Re-check leadership status after validation
      const finalLeaderStatus = await this.distributedLock.isLeader();

      await this.prisma.clusterNode.update({
        where: { instanceId },
        data: {
          lastHeartbeat: new Date(),
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
          },
        },
      });

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

        const staleLeaders = staleNodes.filter((n) => n.isLeader);
        if (staleLeaders.length > 0) {
          this.logger.error(
            `[Cleanup] CRITICAL: Removed ${staleLeaders.length} stale LEADER node(s): ${staleLeaders.map((n) => n.hostname).join(', ')}`,
          );
        }

        this.logger.warn(
          `[Cleanup] Marked ${result.count} stale node(s) as inactive`,
        );
      }

      // ADDITIONAL SAFETY: Ensure only one leader exists across all nodes
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
   * Enforce that only one node can be marked as leader
   * If multiple leaders detected, keep the one with the most recent heartbeat
   */
  private async enforceOneLeader() {
    try {
      const leaders = await this.prisma.clusterNode.findMany({
        where: {
          isLeader: true,
        },
        orderBy: {
          lastHeartbeat: 'desc',
        },
      });

      if (leaders.length > 1) {
        this.logger.error(
          `[EnforceLeader] CRITICAL: Found ${leaders.length} leaders! Fixing...`,
        );

        // Keep the most recent leader (first in the sorted list)
        const validLeader = leaders[0];
        const invalidLeaders = leaders.slice(1);

        // Remove leader status from all others
        await this.prisma.clusterNode.updateMany({
          where: {
            instanceId: {
              in: invalidLeaders.map((l) => l.instanceId),
            },
          },
          data: {
            isLeader: false,
          },
        });

        this.logger.warn(
          `[EnforceLeader] Demoted ${invalidLeaders.length} invalid leader(s). Current leader: ${validLeader.hostname} (${validLeader.instanceId})`,
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
    return this.prisma.clusterNode.findMany({
      where: { status: 'active' },
      orderBy: { lastHeartbeat: 'desc' },
    });
  }

  /**
   * Get the current leader node
   */
  async getLeaderNode() {
    return this.prisma.clusterNode.findFirst({
      where: {
        isLeader: true,
        status: 'active',
      },
      orderBy: { lastHeartbeat: 'desc' },
    });
  }

  /**
   * Get cluster statistics
   */
  async getClusterStats() {
    const [total, active, stale, inactive, leaders] = await Promise.all([
      this.prisma.clusterNode.count(),
      this.prisma.clusterNode.count({ where: { status: 'active' } }),
      this.prisma.clusterNode.count({ where: { status: 'stale' } }),
      this.prisma.clusterNode.count({ where: { status: 'inactive' } }),
      this.prisma.clusterNode.findMany({
        where: { isLeader: true },
        select: {
          hostname: true,
          instanceId: true,
          status: true,
          lastHeartbeat: true,
        },
      }),
    ]);

    return {
      total,
      active,
      stale,
      inactive,
      leaders: leaders,
      leaderCount: leaders.length,
      hasMultipleLeaders: leaders.length > 1,
    };
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
    return { success: true, message: 'Leader enforcement completed' };
  }
}
