import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Distributed lock service using PostgreSQL advisory locks
 * Ensures only one node in the cluster can perform critical operations
 */
@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly instanceId: string;
  private heldLocks = new Map<string, { lockId: number; acquiredAt: number }>();

  constructor(private prisma: PrismaService) {
    // Generate unique instance ID for this container
    this.instanceId = `${process.env.HOSTNAME || 'unknown'}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.logger.log(`[Init] Instance ID: ${this.instanceId}`);
  }

  /**
   * Acquire an advisory lock with timeout
   * Returns true if lock was acquired, false otherwise
   */
  async tryAcquireLock(
    lockName: string,
    timeoutMs: number = 5000,
  ): Promise<boolean> {
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
      const acquired = await this.tryAcquireLock(lockName, timeoutMs);

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
    const lockName = 'cluster:leader';

    // Simply check if we have the leader lock in our held locks
    // Don't try to acquire it - that would release it immediately!
    return this.heldLocks.has(lockName);
  }

  /**
   * Try to acquire leader lock immediately (non-blocking)
   * Returns true if acquired, false if already held
   * Does NOT wait or retry
   */
  async tryAcquireLeaderLock(): Promise<boolean> {
    const lockName = 'cluster:leader';
    return this.tryAcquireLock(lockName, 0);
  }

  /**
   * Acquire and hold leader lock for a duration
   * Used for periodic tasks that should only run on one node
   * CRITICAL: Uses PostgreSQL advisory lock for true distributed locking
   */
  async acquireLeaderLock(): Promise<boolean> {
    const lockName = 'cluster:leader';
    const acquired = await this.tryAcquireLock(lockName, 5000);

    if (acquired) {
      this.logger.log(
        '[LeaderLock] Successfully acquired leader lock - this node is now the leader',
      );
    }

    return acquired;
  }

  /**
   * Release leader lock
   */
  async releaseLeaderLock(): Promise<void> {
    await this.releaseLock('cluster:leader');
  }

  /**
   * Cleanup all locks held by this instance
   * Should be called on shutdown
   */
  async releaseAllLocks(): Promise<void> {
    const locks = Array.from(this.heldLocks.keys());
    this.logger.log(
      `[Shutdown] Releasing ${locks.length} held lock(s): ${locks.join(', ')}`,
    );

    for (const lockName of locks) {
      await this.releaseLock(lockName);
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
  } {
    const lockName = 'cluster:leader';
    const lockInfo = this.heldLocks.get(lockName);

    return {
      isLeader: lockInfo !== undefined,
      heldForMs: lockInfo ? Date.now() - lockInfo.acquiredAt : null,
      instanceId: this.instanceId,
    };
  }
}
