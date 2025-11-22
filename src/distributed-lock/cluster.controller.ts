import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { DistributedLockService } from './distributed-lock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('cluster')
@UseGuards(JwtAuthGuard)
export class ClusterController {
  constructor(
    private readonly clusterHeartbeat: ClusterHeartbeatService,
    private readonly distributedLock: DistributedLockService,
  ) {}

  /**
   * Get all active cluster nodes
   */
  @Get('nodes')
  async getNodes() {
    const nodes = await this.clusterHeartbeat.getActiveNodes();
    return {
      count: nodes.length,
      nodes: nodes.map((node) => ({
        id: node.id,
        hostname: node.hostname,
        instanceId: node.instanceId,
        ipAddress: node.ipAddress,
        isLeader: node.isLeader,
        status: node.status,
        lastHeartbeat: node.lastHeartbeat,
        version: node.version,
        metadata: node.metadata,
      })),
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
    const dbLeader = await this.clusterHeartbeat.getLeaderNode();
    const lockStatus = this.distributedLock.getLeaderLockStatus();
    const allLeaders = await this.clusterHeartbeat
      .getClusterStats()
      .then((stats) => stats.leaders);

    const isConsistent =
      allLeaders.length === 1 &&
      (!dbLeader ||
        (lockStatus.isLeader && dbLeader.instanceId === lockStatus.instanceId));

    return {
      status: isConsistent ? 'healthy' : 'inconsistent',
      lockHolder: lockStatus.isLeader
        ? {
            instanceId: lockStatus.instanceId,
            heldForMs: lockStatus.heldForMs,
          }
        : null,
      dbLeader: dbLeader
        ? {
            hostname: dbLeader.hostname,
            instanceId: dbLeader.instanceId,
            ipAddress: dbLeader.ipAddress,
            lastHeartbeat: dbLeader.lastHeartbeat,
            status: dbLeader.status,
          }
        : null,
      allLeadersInDb: allLeaders.map((l) => ({
        hostname: l.hostname,
        instanceId: l.instanceId,
        ipAddress: l.ipAddress,
        status: l.status,
        lastHeartbeat: l.lastHeartbeat,
      })),
      issues: [
        allLeaders.length === 0 && 'NO_LEADER',
        allLeaders.length > 1 && 'MULTIPLE_LEADERS',
        lockStatus.isLeader && !dbLeader && 'LOCK_WITHOUT_DB_ENTRY',
        !lockStatus.isLeader && dbLeader && 'DB_ENTRY_WITHOUT_LOCK',
        lockStatus.isLeader &&
          dbLeader &&
          dbLeader.instanceId !== lockStatus.instanceId &&
          'LOCK_DB_MISMATCH',
      ].filter(Boolean),
    };
  }

  /**
   * Manually trigger cleanup of stale nodes
   */
  @Get('admin/cleanup')
  async manualCleanup() {
    return this.clusterHeartbeat.manualCleanup();
  }

  /**
   * Manually enforce single leader (fixes split-brain)
   */
  @Get('admin/enforce-leader')
  async manualEnforceLeader() {
    return this.clusterHeartbeat.manualEnforceLeader();
  }

  /**
   * Check and ensure leader exists (auto-elects if needed)
   */
  @Get('admin/ensure-leader')
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
}
