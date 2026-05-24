import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as os from 'os';
import { PrismaService } from '../prisma/prisma.service';

const LEADER_LEASE_NAME = 'cluster:leader';
const DEFAULT_LEASE_TTL_SECONDS = 30;
const MIN_LEASE_TTL_SECONDS = 5;
const MIN_RENEW_INTERVAL_MS = 1000;

type ClusterLeaseRecord = {
  id: string;
  leaseName: string;
  ownerNodeId: string | null;
  ownerHostname: string | null;
  generation: number;
  ttlSeconds: number;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type LeaseSnapshot = {
  leaseName: string;
  ownerNodeId: string | null;
  ownerHostname: string | null;
  generation: number;
  ttlSeconds: number;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
  isExpired: boolean;
  isHeldByThisInstance: boolean;
  fencingToken: number;
};

type AcquireLeaseOptions = {
  ttlSeconds?: number;
  autoRenew?: boolean;
  renewIntervalMs?: number;
};

type HeldLease = LeaseSnapshot & {
  autoRenew: boolean;
  renewIntervalMs: number;
  renewalTimer: ReturnType<typeof setInterval> | null;
};

/**
 * Distributed lock service using PostgreSQL advisory locks
 * Ensures only one node in the cluster can perform critical operations
 */
@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly instanceId: string;
  private heldLocks = new Map<string, { lockId: number; acquiredAt: number }>();
  private heldLeases = new Map<string, HeldLease>();

  constructor(private prisma: PrismaService) {
    // Generate unique instance ID for this container
    this.instanceId = `${process.env.HOSTNAME || 'unknown'}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.logger.log(`[Init] Instance ID: ${this.instanceId}`);
  }

  async onModuleDestroy() {
    await this.releaseAllLocks();
  }

  /**
   * Acquire an advisory lock with timeout
   * Returns true if lock was acquired, false otherwise
   */
  async tryAcquireLock(lockName: string): Promise<boolean> {
    const lockId = this.stringToLockId(lockName);
    const startTime = Date.now();

    try {
      // Try to acquire PostgreSQL advisory lock (non-blocking)
      const result = await this.prisma.$queryRaw<
        [
          {
            pg_try_advisory_lock: boolean;
          },
        ]
      >`
        SELECT pg_try_advisory_lock(${lockId}::bigint) as pg_try_advisory_lock
      `;

      const acquired = result[0]?.pg_try_advisory_lock || false;

      if (acquired) {
        this.heldLocks.set(lockName, { lockId, acquiredAt: Date.now() });
        this.logger.log(
          `[Lock] Acquired lock "${lockName}" (id: ${lockId}) after ${Date.now() - startTime}ms`,
        );
        return true;
      } else {
        this.logger.debug(
          `[Lock] Failed to acquire lock "${lockName}" (id: ${lockId}) - already held by another instance`,
        );
        return false;
      }
    } catch (error) {
      this.logger.error(
        `[Lock] Error acquiring lock "${lockName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Release an advisory lock
   */
  async releaseLock(lockName: string): Promise<void> {
    const lockInfo = this.heldLocks.get(lockName);
    if (!lockInfo) {
      this.logger.warn(
        `[Lock] Attempted to release lock "${lockName}" that was not held by this instance`,
      );
      return;
    }

    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${lockInfo.lockId}::bigint)
      `;
      this.heldLocks.delete(lockName);
      const heldDuration = Date.now() - lockInfo.acquiredAt;
      this.logger.log(
        `[Lock] Released lock "${lockName}" (id: ${lockInfo.lockId}) after ${heldDuration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[Lock] Error releasing lock "${lockName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Execute a function with an exclusive lock
   * Automatically releases lock after execution or on error
   */
  async withLock<T>(
    lockName: string,
    fn: () => Promise<T>,
    options: {
      timeoutMs?: number;
      retryDelayMs?: number;
      maxRetries?: number;
    } = {},
  ): Promise<T | null> {
    const { timeoutMs = 5000, retryDelayMs = 1000, maxRetries = 3 } = options;

    let retries = 0;
    while (retries < maxRetries) {
      const acquired = await this.tryAcquireLock(lockName);

      if (acquired) {
        try {
          const result = await fn();
          return result;
        } finally {
          await this.releaseLock(lockName);
        }
      }

      retries++;
      if (retries < maxRetries) {
        this.logger.debug(
          `[Lock] Retry ${retries}/${maxRetries} for lock "${lockName}" after ${retryDelayMs}ms`,
        );
        await this.sleep(retryDelayMs);
      }
    }

    this.logger.warn(
      `[Lock] Failed to acquire lock "${lockName}" after ${maxRetries} retries`,
    );
    return null;
  }

  /**
   * Check if this instance is currently the leader
   * Returns true if we are holding the leader lock
   */
  async isLeader(): Promise<boolean> {
    return this.hasActiveHeldLease(LEADER_LEASE_NAME);
  }

  /**
   * Try to acquire leader lock immediately (non-blocking)
   * Returns true if acquired, false if already held
   * Does NOT wait or retry
   */
  async tryAcquireLeaderLock(): Promise<boolean> {
    const lease = await this.acquireLease(LEADER_LEASE_NAME, {
      autoRenew: true,
    });
    return lease !== null;
  }

  /**
   * Acquire and hold leader lock for a duration
   * Used for periodic tasks that should only run on one node
   * CRITICAL: Uses PostgreSQL advisory lock for true distributed locking
   */
  async acquireLeaderLock(): Promise<boolean> {
    const lease = await this.acquireLease(LEADER_LEASE_NAME, {
      autoRenew: true,
    });
    const acquired = lease !== null;

    if (acquired) {
      this.logger.log(
        `[LeaderLock] Successfully acquired leader lease generation ${lease?.generation} - this node is now the leader`,
      );
    }

    return acquired;
  }

  /**
   * Release leader lock
   */
  async releaseLeaderLock(): Promise<void> {
    await this.releaseLease(LEADER_LEASE_NAME);
  }

  async acquireLease(
    leaseName: string,
    options: AcquireLeaseOptions = {},
  ): Promise<LeaseSnapshot | null> {
    const ttlSeconds = this.resolveLeaseTtlSeconds(options.ttlSeconds);

    try {
      const result = await this.prisma.$queryRaw<ClusterLeaseRecord[]>`
        INSERT INTO "ClusterLease" (
          "id",
          "leaseName",
          "ownerNodeId",
          "ownerHostname",
          "generation",
          "ttlSeconds",
          "acquiredAt",
          "renewedAt",
          "expiresAt"
        )
        VALUES (
          ${randomUUID()},
          ${leaseName},
          ${this.instanceId},
          ${os.hostname()},
          1,
          ${ttlSeconds},
          NOW(),
          NOW(),
          NOW() + ${ttlSeconds} * interval '1 second'
        )
        ON CONFLICT ("leaseName") DO UPDATE
        SET
          "ownerNodeId" = EXCLUDED."ownerNodeId",
          "ownerHostname" = EXCLUDED."ownerHostname",
          "generation" = CASE
            WHEN "ClusterLease"."ownerNodeId" = EXCLUDED."ownerNodeId"
              THEN "ClusterLease"."generation"
            ELSE "ClusterLease"."generation" + 1
          END,
          "ttlSeconds" = EXCLUDED."ttlSeconds",
          "acquiredAt" = CASE
            WHEN "ClusterLease"."ownerNodeId" = EXCLUDED."ownerNodeId"
              THEN "ClusterLease"."acquiredAt"
            ELSE NOW()
          END,
          "renewedAt" = NOW(),
          "expiresAt" = NOW() + ${ttlSeconds} * interval '1 second',
          "updatedAt" = NOW()
        WHERE
          "ClusterLease"."expiresAt" <= NOW()
          OR "ClusterLease"."ownerNodeId" IS NULL
          OR "ClusterLease"."ownerNodeId" = EXCLUDED."ownerNodeId"
        RETURNING
          "id",
          "leaseName",
          "ownerNodeId",
          "ownerHostname",
          "generation",
          "ttlSeconds",
          "acquiredAt",
          "renewedAt",
          "expiresAt",
          "metadata",
          "createdAt",
          "updatedAt"
      `;

      const row = result[0];
      if (!row) {
        this.logger.debug(
          `[Lease] Failed to acquire lease "${leaseName}" - held by another active node`,
        );
        return null;
      }

      const snapshot = this.toLeaseSnapshot(row);
      this.trackHeldLease(leaseName, snapshot, options);
      this.logger.log(
        `[Lease] Acquired lease "${leaseName}" with generation ${snapshot.generation} (ttl ${snapshot.ttlSeconds}s)`,
      );
      return snapshot;
    } catch (error) {
      this.logger.error(
        `[Lease] Error acquiring lease "${leaseName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async renewLease(
    leaseName: string,
    options: Pick<AcquireLeaseOptions, 'ttlSeconds'> = {},
  ): Promise<LeaseSnapshot | null> {
    const heldLease = this.heldLeases.get(leaseName);
    if (!heldLease) {
      this.logger.warn(
        `[Lease] Attempted to renew lease "${leaseName}" that is not held locally`,
      );
      return null;
    }

    const ttlSeconds = this.resolveLeaseTtlSeconds(
      options.ttlSeconds ?? heldLease.ttlSeconds,
    );

    try {
      const result = await this.prisma.$queryRaw<ClusterLeaseRecord[]>`
        UPDATE "ClusterLease"
        SET
          "ttlSeconds" = ${ttlSeconds},
          "renewedAt" = NOW(),
          "expiresAt" = NOW() + ${ttlSeconds} * interval '1 second',
          "updatedAt" = NOW()
        WHERE
          "leaseName" = ${leaseName}
          AND "ownerNodeId" = ${this.instanceId}
          AND "generation" = ${heldLease.generation}
        RETURNING
          "id",
          "leaseName",
          "ownerNodeId",
          "ownerHostname",
          "generation",
          "ttlSeconds",
          "acquiredAt",
          "renewedAt",
          "expiresAt",
          "metadata",
          "createdAt",
          "updatedAt"
      `;

      const row = result[0];
      if (!row) {
        this.logger.warn(
          `[Lease] Lost lease "${leaseName}" while attempting renewal for generation ${heldLease.generation}`,
        );
        this.untrackHeldLease(leaseName);
        return null;
      }

      const snapshot = this.toLeaseSnapshot(row);
      this.trackHeldLease(leaseName, snapshot, {
        autoRenew: heldLease.autoRenew,
        renewIntervalMs: heldLease.renewIntervalMs,
      });
      this.logger.debug(
        `[Lease] Renewed lease "${leaseName}" generation ${snapshot.generation} until ${snapshot.expiresAt.toISOString()}`,
      );
      return snapshot;
    } catch (error) {
      this.logger.error(
        `[Lease] Error renewing lease "${leaseName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async releaseLease(leaseName: string): Promise<boolean> {
    const heldLease = this.heldLeases.get(leaseName);
    if (!heldLease) {
      this.logger.warn(
        `[Lease] Attempted to release lease "${leaseName}" that is not held locally`,
      );
      return false;
    }

    try {
      const result = await this.prisma.$queryRaw<ClusterLeaseRecord[]>`
        UPDATE "ClusterLease"
        SET
          "ownerNodeId" = NULL,
          "ownerHostname" = NULL,
          "renewedAt" = NOW(),
          "expiresAt" = NOW(),
          "updatedAt" = NOW()
        WHERE
          "leaseName" = ${leaseName}
          AND "ownerNodeId" = ${this.instanceId}
          AND "generation" = ${heldLease.generation}
        RETURNING
          "id",
          "leaseName",
          "ownerNodeId",
          "ownerHostname",
          "generation",
          "ttlSeconds",
          "acquiredAt",
          "renewedAt",
          "expiresAt",
          "metadata",
          "createdAt",
          "updatedAt"
      `;

      const released = result.length > 0;
      this.untrackHeldLease(leaseName);

      if (released) {
        this.logger.log(
          `[Lease] Released lease "${leaseName}" generation ${heldLease.generation}`,
        );
      } else {
        this.logger.warn(
          `[Lease] Lease "${leaseName}" was no longer owned by this node during release`,
        );
      }

      return released;
    } catch (error) {
      this.logger.error(
        `[Lease] Error releasing lease "${leaseName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      this.untrackHeldLease(leaseName);
      return false;
    }
  }

  async getLeaseSnapshot(leaseName: string): Promise<LeaseSnapshot | null> {
    try {
      const result = await this.prisma.$queryRaw<ClusterLeaseRecord[]>`
        SELECT
          "id",
          "leaseName",
          "ownerNodeId",
          "ownerHostname",
          "generation",
          "ttlSeconds",
          "acquiredAt",
          "renewedAt",
          "expiresAt",
          "metadata",
          "createdAt",
          "updatedAt"
        FROM "ClusterLease"
        WHERE "leaseName" = ${leaseName}
        LIMIT 1
      `;

      const lease = result[0] ?? null;

      return lease ? this.toLeaseSnapshot(lease) : null;
    } catch (error) {
      this.logger.error(
        `[Lease] Error reading lease "${leaseName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async getLeaderLeaseSnapshot(): Promise<LeaseSnapshot | null> {
    return this.getLeaseSnapshot(LEADER_LEASE_NAME);
  }

  async validateLeaseFenceToken(
    leaseName: string,
    expectedGeneration: number,
    ownerNodeId: string = this.instanceId,
  ): Promise<boolean> {
    const lease = await this.getLeaseSnapshot(leaseName);
    if (!lease) {
      return false;
    }

    return (
      !lease.isExpired &&
      lease.ownerNodeId === ownerNodeId &&
      lease.generation === expectedGeneration
    );
  }

  async validateLeaderFenceToken(
    expectedGeneration: number,
    ownerNodeId?: string,
  ): Promise<boolean> {
    return this.validateLeaseFenceToken(
      LEADER_LEASE_NAME,
      expectedGeneration,
      ownerNodeId,
    );
  }

  /**
   * Cleanup all locks held by this instance
   * Should be called on shutdown
   */
  async releaseAllLocks(): Promise<void> {
    const locks = Array.from(this.heldLocks.keys());
    const leases = Array.from(this.heldLeases.keys());
    this.logger.log(
      `[Shutdown] Releasing ${locks.length} advisory lock(s) and ${leases.length} lease(s)`,
    );

    for (const lockName of locks) {
      await this.releaseLock(lockName);
    }

    for (const leaseName of leases) {
      await this.releaseLease(leaseName);
    }
  }

  /**
   * Get information about currently held locks
   */
  getHeldLocksInfo(): Array<{ name: string; heldForMs: number }> {
    const now = Date.now();
    return Array.from(this.heldLocks.entries()).map(([name, info]) => ({
      name,
      heldForMs: now - info.acquiredAt,
    }));
  }

  /**
   * Convert string to a consistent numeric lock ID for PostgreSQL
   * Uses a simple hash function to generate a 32-bit integer
   */
  private stringToLockId(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure positive number for PostgreSQL bigint
    return Math.abs(hash);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Get detailed status about leader lock
   * Useful for debugging and monitoring
   */
  getLeaderLockStatus(): {
    isLeader: boolean;
    heldForMs: number | null;
    instanceId: string;
    ownerNodeId: string | null;
    generation: number | null;
    fencingToken: number | null;
    expiresAt: Date | null;
  } {
    const lease = this.getActiveHeldLease(LEADER_LEASE_NAME);

    return {
      isLeader: lease !== null,
      heldForMs: lease ? Date.now() - lease.acquiredAt.getTime() : null,
      instanceId: this.instanceId,
      ownerNodeId: lease?.ownerNodeId ?? null,
      generation: lease?.generation ?? null,
      fencingToken: lease?.fencingToken ?? null,
      expiresAt: lease?.expiresAt ?? null,
    };
  }

  private resolveLeaseTtlSeconds(ttlSeconds?: number): number {
    const configured = Number.parseInt(
      String(ttlSeconds ?? process.env.CLUSTER_LEASE_TTL_SECONDS ?? ''),
      10,
    );

    if (Number.isInteger(configured) && configured >= MIN_LEASE_TTL_SECONDS) {
      return configured;
    }

    return DEFAULT_LEASE_TTL_SECONDS;
  }

  private resolveRenewIntervalMs(
    ttlSeconds: number,
    renewIntervalMs?: number,
  ): number {
    const configured = Number.parseInt(
      String(
        renewIntervalMs ?? process.env.CLUSTER_LEASE_RENEW_INTERVAL_MS ?? '',
      ),
      10,
    );

    if (Number.isInteger(configured) && configured >= MIN_RENEW_INTERVAL_MS) {
      return configured;
    }

    return Math.max(MIN_RENEW_INTERVAL_MS, Math.floor((ttlSeconds * 1000) / 3));
  }

  private toLeaseSnapshot(lease: ClusterLeaseRecord): LeaseSnapshot {
    return {
      leaseName: lease.leaseName,
      ownerNodeId: lease.ownerNodeId,
      ownerHostname: lease.ownerHostname,
      generation: lease.generation,
      ttlSeconds: lease.ttlSeconds,
      acquiredAt: new Date(lease.acquiredAt),
      renewedAt: new Date(lease.renewedAt),
      expiresAt: new Date(lease.expiresAt),
      isExpired: new Date(lease.expiresAt).getTime() <= Date.now(),
      isHeldByThisInstance: lease.ownerNodeId === this.instanceId,
      fencingToken: lease.generation,
    };
  }

  private trackHeldLease(
    leaseName: string,
    snapshot: LeaseSnapshot,
    options: AcquireLeaseOptions,
  ) {
    const existing = this.heldLeases.get(leaseName);
    if (existing?.renewalTimer) {
      clearInterval(existing.renewalTimer);
    }

    const autoRenew = options.autoRenew ?? existing?.autoRenew ?? false;
    const renewIntervalMs = this.resolveRenewIntervalMs(
      snapshot.ttlSeconds,
      options.renewIntervalMs ?? existing?.renewIntervalMs,
    );

    const heldLease: HeldLease = {
      ...snapshot,
      autoRenew,
      renewIntervalMs,
      renewalTimer: null,
    };

    if (autoRenew) {
      heldLease.renewalTimer = setInterval(() => {
        this.renewLease(leaseName).catch((error) =>
          this.logger.error(
            `[Lease] Auto-renew failed for "${leaseName}": ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }, renewIntervalMs);
    }

    this.heldLeases.set(leaseName, heldLease);
  }

  private untrackHeldLease(leaseName: string) {
    const heldLease = this.heldLeases.get(leaseName);
    if (heldLease?.renewalTimer) {
      clearInterval(heldLease.renewalTimer);
    }

    this.heldLeases.delete(leaseName);
  }

  private getActiveHeldLease(leaseName: string): HeldLease | null {
    const heldLease = this.heldLeases.get(leaseName);
    if (!heldLease) {
      return null;
    }

    if (heldLease.expiresAt.getTime() <= Date.now()) {
      this.logger.warn(
        `[Lease] Local lease "${leaseName}" expired before release/renewal completed`,
      );
      this.untrackHeldLease(leaseName);
      return null;
    }

    return heldLease;
  }

  private hasActiveHeldLease(leaseName: string): boolean {
    return this.getActiveHeldLease(leaseName) !== null;
  }
}
