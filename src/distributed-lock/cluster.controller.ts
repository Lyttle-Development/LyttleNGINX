import {
  Controller,
  Get,
  Logger,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { DistributedLockService } from './distributed-lock.service';
import { ReloaderService } from '../reloader/reloader.service';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  buildClusterNodeUrl,
  getClusterNodeControlPlaneEndpoint,
} from '../utils/network-utils';

@Controller('cluster')
@UseGuards(ApiKeyGuard)
@AuthorizeAdmin('viewer')
export class ClusterController {
  private readonly logger = new Logger(ClusterController.name);

  constructor(
    private readonly clusterHeartbeat: ClusterHeartbeatService,
    private readonly distributedLock: DistributedLockService,
    private readonly reloader: ReloaderService,
  ) {}

  /**
   * Trigger a reload on this node and optionally broadcast to others
   */
  @Post('reload')
  @AuthorizeAdmin('operator')
  async reload(@Query('broadcast') broadcast: string) {
    const shouldBroadcast = broadcast !== 'false';
    const broadcastSummary = {
      requested: shouldBroadcast,
      attemptedNodes: 0,
      skippedNodes: [] as string[],
      authenticated: false,
    };

    this.logger.log(`[Reload] Triggered. Broadcast: ${shouldBroadcast}`);

    // Reload local
    const result = await this.reloader.reloadConfig();

    if (shouldBroadcast) {
      // Get other active nodes
      const nodes = await this.clusterHeartbeat.getActiveNodes();
      const thisInstanceId = this.distributedLock.getInstanceId();

      const otherNodes = nodes.filter((n) => n.instanceId !== thisInstanceId);

      this.logger.log(
        `[Reload] Broadcasting to ${otherNodes.length} other nodes...`,
      );

      // Get API key from environment for inter-node communication
      const apiKey = process.env.API_KEY?.split(',')[0]?.trim();

      if (!apiKey) {
        this.logger.warn(
          '[Reload] Skipping inter-node broadcast because no API key is configured for authenticated peer requests',
        );
        broadcastSummary.skippedNodes = otherNodes.map(
          (node) => node.hostname ?? node.instanceId,
        );
      } else {
        broadcastSummary.authenticated = true;

        await Promise.allSettled(
          otherNodes.map(async (node) => {
            const url = buildClusterNodeUrl(node, '/cluster/reload', {
              broadcast: 'false',
            });

            if (!url) {
              const nodeLabel = node.hostname ?? node.instanceId;
              broadcastSummary.skippedNodes.push(nodeLabel);
              this.logger.warn(
                `[Reload] Skipping ${nodeLabel} because it does not have a valid registered control-plane endpoint`,
              );
              return;
            }

            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);

              broadcastSummary.attemptedNodes += 1;
              this.logger.debug(`[Reload] Calling ${url}`);

              try {
                await fetch(url, {
                  method: 'POST',
                  headers: {
                    'X-API-Key': apiKey,
                  },
                  signal: controller.signal,
                });
              } finally {
                clearTimeout(timeoutId);
              }
            } catch (error) {
              this.logger.error(
                `[Reload] Failed to broadcast to ${node.hostname} (${node.instanceId}): ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }),
        );
      }
    }

    return {
      local: result,
      broadcast: broadcastSummary,
    };
  }

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
        controlPlane: getClusterNodeControlPlaneEndpoint(node),
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
  @AuthorizeAdmin('platform-admin')
  async manualCleanup() {
    return this.clusterHeartbeat.manualCleanup();
  }

  /**
   * Manually enforce single leader (fixes split-brain)
   */
  @Get('admin/enforce-leader')
  @AuthorizeAdmin('platform-admin')
  async manualEnforceLeader() {
    return this.clusterHeartbeat.manualEnforceLeader();
  }

  /**
   * Check and ensure leader exists (auto-elects if needed)
   */
  @Get('admin/ensure-leader')
  @AuthorizeAdmin('platform-admin')
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
