import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('cluster')
@UseGuards(JwtAuthGuard)
export class ClusterController {
  constructor(private readonly clusterHeartbeat: ClusterHeartbeatService) {}

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
        lastHeartbeat: leader.lastHeartbeat,
        version: leader.version,
        metadata: leader.metadata,
      },
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
}
