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
  private readonly heartbeatIntervalMs = 30000; // 30 seconds
  private readonly staleThresholdMs = 120000; // 2 minutes

  constructor(
    private prisma: PrismaService,
    private distributedLock: DistributedLockService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('[Init] Starting cluster heartbeat service');

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

      // Start cleanup of stale nodes
      setInterval(
        () =>
          this.cleanupStaleNodes().catch((err) =>
            this.logger.error(`[Cleanup] Interval error: ${err.message}`),
          ),
        60000,
      ); // Every minute
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

      await this.prisma.clusterNode.update({
        where: { instanceId },
        data: {
          lastHeartbeat: new Date(),
          isLeader,
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

      this.logger.debug(`[Heartbeat] Sent (Leader: ${isLeader})`);
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
      await this.prisma.clusterNode.update({
        where: { instanceId },
        data: {
          status: 'inactive',
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
   */
  private async cleanupStaleNodes() {
    try {
      const staleThreshold = new Date(Date.now() - this.staleThresholdMs);

      const result = await this.prisma.clusterNode.updateMany({
        where: {
          lastHeartbeat: { lt: staleThreshold },
          status: 'active',
        },
        data: {
          status: 'stale',
        },
      });

      if (result.count > 0) {
        this.logger.warn(
          `[Cleanup] Marked ${result.count} stale node(s) as inactive`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Cleanup] Failed: ${error instanceof Error ? error.message : String(error)}`,
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
    const [total, active, stale, inactive, leader] = await Promise.all([
      this.prisma.clusterNode.count(),
      this.prisma.clusterNode.count({ where: { status: 'active' } }),
      this.prisma.clusterNode.count({ where: { status: 'stale' } }),
      this.prisma.clusterNode.count({ where: { status: 'inactive' } }),
      this.prisma.clusterNode.findFirst({
        where: { isLeader: true, status: 'active' },
        select: { hostname: true, instanceId: true },
      }),
    ]);

    return {
      total,
      active,
      stale,
      inactive,
      leader: leader
        ? { hostname: leader.hostname, instanceId: leader.instanceId }
        : null,
    };
  }
}
