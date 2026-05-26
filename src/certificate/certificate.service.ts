import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as process from 'node:process';
import * as os from 'node:os';
import * as fs from 'fs';
import * as path from 'path';
import { addDays } from 'date-fns';
import {
  getCertificateStorageName,
  hashDomains,
  joinDomains,
  normalizeDomain,
  normalizeDomains,
  parseDomains,
} from '../utils/domain-utils';
import { AlertService } from '../alert/alert.service';
import { CertificateOrderService } from './certificate-order.service';
import { CertificateOrderSourceType } from './certificate-order.constants';
import { ClusterHeartbeatService } from '../distributed-lock/cluster-heartbeat.service';
import { ClusterOperationsService } from '../distributed-lock/cluster-operations.service';
import { DistributedLockService } from '../distributed-lock/distributed-lock.service';
import { HealthService } from '../health/health.service';
import { runCommand } from '../utils/process-utils';
import { AcmeChallengeInfoDto } from './dto/acme-challenge.dto';
import {
  buildAcmeCertbotPlan,
  resolveAcmeStrategy,
} from './acme-strategy';

// Validate ADMIN_EMAIL is set (required by Let's Encrypt)
const adminEmail = process.env.ADMIN_EMAIL;
if (!adminEmail) {
  throw new Error(
    "ADMIN_EMAIL environment variable is required for Let's Encrypt certificate issuance. " +
      'Please set ADMIN_EMAIL in your environment configuration.',
  );
}

const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

class ArtifactActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactActivationError';
  }
}

type AcmeChallengeRecord = {
  id: string;
  orderId: string | null;
  token: string;
  domain: string;
  challengeType: string;
  provider: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  presentedAt: Date;
  cleanedUpAt: Date | null;
  finalizedAt: Date | null;
  lastServedAt: Date | null;
  expiresAt: Date;
};

@Injectable()
export class CertificateService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CertificateService.name);
  private interval: NodeJS.Timeout | null = null;
  private readonly renewIntervalMs = 1000 * 60 * 60 * 12; // 12 hours
  private leaderLockInterval: NodeJS.Timeout | null = null;
  private isCurrentlyLeader = false;

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
    private certificateOrders: CertificateOrderService,
    private clusterOperations: ClusterOperationsService,
    private distributedLock: DistributedLockService,
    private healthService: HealthService,
    @Inject(forwardRef(() => ClusterHeartbeatService))
    private clusterHeartbeat: ClusterHeartbeatService | null,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `[Init] Instance ID: ${this.distributedLock.getInstanceId()}`,
    );

    // Start leader election process - only leader will renew certificates
    this.logger.log(
      `[Init] Starting leader election for certificate renewal (check interval: 30s)`,
    );

    // Try to become leader immediately
    await this.leaderElectionCheck();

    // Re-check every 30 seconds (in case leader dies or we want to take over)
    this.leaderLockInterval = setInterval(
      () => this.leaderElectionCheck(),
      30000, // Check every 30 seconds
    );

    // Sync certificates from DB to FS on startup
    this.syncCertificates().catch((err) =>
      this.logger.error(
        `[Sync] Initial certificate sync failed: ${err.message}`,
      ),
    );

    // Schedule periodic sync (every 5 minutes)
    setInterval(
      () => {
        this.syncCertificates().catch((err) =>
          this.logger.error(
            `[Sync] Periodic certificate sync failed: ${err.message}`,
          ),
        );
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Sync certificates from DB to local filesystem
   * Ensures all nodes have the certificates needed to serve traffic
   * PRODUCTION-GRADE: Atomic operations and comprehensive error handling
   */
  async syncCertificates() {
    this.logger.log('[Sync] Starting certificate synchronization...');

    try {
      const certs = await this.prisma.certificate.findMany({
        where: { isOrphaned: false },
      });

      let syncedCount = 0;
      const errors: Array<{ domain: string; error: string }> = [];

      for (const cert of certs) {
        try {
          const domains = parseDomains(cert.domains, { allowWildcard: true });
          const primaryDomain = domains[0];

          // Quick validation check
          const validation = await this.validateCertificate(
            cert.certPem,
            cert.keyPem,
            domains,
          );
          if (!validation.valid) {
            this.logger.error(
              `[Sync] Skipping invalid certificate for ${cert.domains}: ${validation.error}`,
            );
            errors.push({
              domain: cert.domains,
              error: `Invalid certificate: ${validation.error}`,
            });

            // Mark certificate as orphaned if it's invalid
            await this.prisma.certificate
              .update({
                where: { id: cert.id },
                data: { isOrphaned: true },
              })
              .catch((err) =>
                this.logger.error(
                  `[Sync] Failed to mark cert as orphaned: ${err.message}`,
                ),
              );

            continue;
          }

          // Check if files exist and match
          const dir = this.certDir(primaryDomain);
          const certPath = path.join(dir, 'fullchain.pem');
          const keyPath = path.join(dir, 'privkey.pem');

          let needsWrite = false;

          if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            needsWrite = true;
            this.logger.debug(
              `[Sync] Certificate files missing for ${primaryDomain}`,
            );
          } else {
            // Check content
            const currentCert = fs.readFileSync(certPath, 'utf8');
            const currentKey = fs.readFileSync(keyPath, 'utf8');

            if (currentCert !== cert.certPem || currentKey !== cert.keyPem) {
              needsWrite = true;
              this.logger.debug(
                `[Sync] Certificate content mismatch for ${primaryDomain}`,
              );
            }
          }

          if (needsWrite) {
            this.logger.log(`[Sync] Updating certificate for ${primaryDomain}`);
            this.writeCertToFs(primaryDomain, cert.certPem, cert.keyPem);
            syncedCount++;
          }
        } catch (certError) {
          const errorMsg =
            certError instanceof Error ? certError.message : String(certError);
          this.logger.error(
            `[Sync] Failed to sync certificate for ${cert.domains}: ${errorMsg}`,
          );
          errors.push({ domain: cert.domains, error: errorMsg });
          // Continue with other certificates
        }
      }

      if (syncedCount > 0) {
        this.logger.log(
          `[Sync] Synchronized ${syncedCount} certificate(s) to local filesystem`,
        );

        // Reload NGINX to pick up new certificates
        try {
          await runCommand('nginx', ['-t']);
          await runCommand('nginx', ['-s', 'reload']);
          this.logger.log('[Sync] NGINX reloaded successfully');
        } catch (reloadErr) {
          const errorMsg =
            reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
          this.logger.error(`[Sync] Failed to reload NGINX: ${errorMsg}`);
          errors.push({
            domain: '__nginx_reload__',
            error: `Failed to reload NGINX after sync: ${errorMsg}`,
          });

          // Send alert for critical NGINX reload failure
          await this.alertService
            .sendAlert({
              type: 'error',
              title: 'NGINX Reload Failed After Certificate Sync',
              message: `Failed to reload NGINX after syncing ${syncedCount} certificate(s): ${errorMsg}`,
              metadata: {
                syncedCount,
                instanceId: this.distributedLock.getInstanceId(),
                timestamp: new Date().toISOString(),
              },
            })
            .catch((alertErr) =>
              this.logger.error(
                `[Sync] Failed to send alert: ${alertErr.message}`,
              ),
            );
        }
      } else {
        this.logger.debug('[Sync] All certificates are up to date');
      }

      // If there were errors, send alert
      if (errors.length > 0) {
        await this.alertService
          .sendAlert({
            type: 'warning',
            title: 'Certificate Sync Errors',
            message: `Failed to sync ${errors.length} certificate(s)`,
            metadata: {
              errors,
              instanceId: this.distributedLock.getInstanceId(),
              timestamp: new Date().toISOString(),
            },
          })
          .catch((alertErr) =>
            this.logger.debug(
              `[Sync] Failed to send alert: ${alertErr.message}`,
            ),
          );
      }

      if (errors.length > 0) {
        this.healthService.recordCertificateSyncFailure(
          `encountered ${errors.length} certificate sync error(s)`,
        );
      } else {
        this.healthService.recordCertificateSyncSuccess(
          `synced ${syncedCount} certificate(s)`,
        );
      }

      return { success: true, syncedCount, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Sync] Certificate synchronization failed: ${errorMsg}`,
      );
      this.healthService.recordCertificateSyncFailure(errorMsg);

      // Send critical alert
      await this.alertService
        .sendAlert({
          type: 'error',
          title: 'Certificate Sync Failed',
          message: `Critical failure in certificate synchronization: ${errorMsg}`,
          metadata: {
            instanceId: this.distributedLock.getInstanceId(),
            timestamp: new Date().toISOString(),
            stack: error instanceof Error ? error.stack : undefined,
          },
        })
        .catch((alertErr) =>
          this.logger.error(`[Sync] Failed to send alert: ${alertErr.message}`),
        );

      return {
        success: false,
        syncedCount: 0,
        errors: [{ domain: 'unknown', error: errorMsg }],
      };
    }
  }

  async onApplicationShutdown() {
    this.logger.log('[Shutdown] Releasing leader lock and clearing intervals');

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.leaderLockInterval) {
      clearInterval(this.leaderLockInterval);
      this.leaderLockInterval = null;
    }

    if (this.isCurrentlyLeader) {
      await this.distributedLock.releaseLeaderLock();
    }

    await this.distributedLock.releaseAllLocks();
  }

  /**
   * Check if this instance should be the leader and start/stop renewal accordingly
   * ENHANCED: Production-grade error handling and automatic recovery
   */
  private async leaderElectionCheck() {
    try {
      // If we're already the leader, verify we still hold the lock
      if (this.isCurrentlyLeader) {
        const stillLeader = await this.distributedLock.isLeader();

        if (!stillLeader) {
          this.logger.error(
            '[Leader] CRITICAL: Lost leadership - lock was released or taken by another node',
          );
          this.isCurrentlyLeader = false;

          // Stop renewal interval
          if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
          }

          // Alert about leadership loss
          await this.alertService
            .sendAlert({
              type: 'error',
              title: 'Certificate Leader Lost',
              message: `Node ${this.distributedLock.getInstanceId()} lost certificate renewal leadership`,
              metadata: {
                instanceId: this.distributedLock.getInstanceId(),
                timestamp: new Date().toISOString(),
              },
            })
            .catch((err) =>
              this.logger.error(
                `[Leader] Failed to send alert: ${err.message}`,
              ),
            );

          this.logger.warn(
            '[Leader] Certificate renewals stopped on this node. Another node should take over.',
          );

          // Trigger immediate re-election attempt
          setTimeout(() => this.leaderElectionCheck(), 2000);
        } else {
          // Verify DB consistency
          if (this.clusterHeartbeat) {
            const dbLeader = await this.clusterHeartbeat.getLeaderNode();
            const thisInstanceId = this.distributedLock.getInstanceId();

            if (dbLeader && dbLeader.instanceId !== thisInstanceId) {
              this.logger.error(
                '[Leader] CRITICAL: We hold lock but another node is DB leader. Releasing lock.',
              );
              this.isCurrentlyLeader = false;
              await this.distributedLock.releaseLeaderLock();

              if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
              }
              return;
            }
          }

          this.logger.debug('[Leader] Health check: Still the leader ✓');
        }
        return;
      }

      // We're not the leader, try to become one
      const acquiredLock = await this.distributedLock.acquireLeaderLock();

      if (acquiredLock) {
        this.logger.log(
          '[Leader] ✓✓✓ This instance is now the LEADER - starting certificate renewal',
        );
        this.isCurrentlyLeader = true;

        // Send alert about new leader
        await this.alertService
          .sendAlert({
            type: 'info',
            title: 'Certificate Leader Elected',
            message: `Node ${this.distributedLock.getInstanceId()} is now the certificate renewal leader`,
            metadata: {
              instanceId: this.distributedLock.getInstanceId(),
              timestamp: new Date().toISOString(),
            },
          })
          .catch((err) =>
            this.logger.debug(`[Leader] Failed to send alert: ${err.message}`),
          );

        // Start renewal interval
        if (!this.interval) {
          this.logger.log(
            `[Leader] Starting renewal interval (every ${this.renewIntervalMs / 1000}s)`,
          );
          this.interval = setInterval(
            () =>
              this.renewAllCertificates().catch((err) =>
                this.logger.error(
                  `[Leader] Renewal error: ${err instanceof Error ? err.message : String(err)}`,
                ),
              ),
            this.renewIntervalMs,
          );

          // Run initial renewal immediately (in background)
          setImmediate(() =>
            this.renewAllCertificates().catch((err) =>
              this.logger.error(
                `[Leader] Initial renewal error: ${err instanceof Error ? err.message : String(err)}`,
              ),
            ),
          );
        }
      } else {
        this.logger.debug(
          '[Leader] Not the leader - another node holds the lock',
        );
      }
    } catch (error) {
      this.logger.error(
        `[Leader] Error in leader election: ${error instanceof Error ? error.message : String(error)}`,
      );

      // On error, ensure we're not stuck thinking we're the leader
      if (this.isCurrentlyLeader) {
        this.logger.warn(
          '[Leader] Resetting leader state due to error in health check',
        );
        this.isCurrentlyLeader = false;

        if (this.interval) {
          clearInterval(this.interval);
          this.interval = null;
        }

        // Try to release the lock (might fail, but attempt anyway)
        try {
          await this.distributedLock.releaseLeaderLock();
        } catch (releaseError) {
          this.logger.error(
            `[Leader] Failed to release lock: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
          );
        }
      }

      // Schedule retry after error
      setTimeout(() => this.leaderElectionCheck(), 5000);
    }
  }

  private certDir(primaryDomain: string) {
    return `/etc/letsencrypt/live/${getCertificateStorageName(primaryDomain)}`;
  }

  private createTempDirectory(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  private async getCertificateExpiryFromFile(certPath: string): Promise<Date> {
    const { stdout } = await runCommand('openssl', [
      'x509',
      '-enddate',
      '-noout',
      '-in',
      certPath,
    ]);
    const match = stdout.match(/notAfter=(.*)/);
    return match ? new Date(match[1]) : addDays(new Date(), 365);
  }

  private async getCertificatePublicKey(certPath: string): Promise<string> {
    const { stdout } = await runCommand('openssl', [
      'x509',
      '-in',
      certPath,
      '-noout',
      '-pubkey',
    ]);
    return stdout.trim();
  }

  private async getPrivateKeyPublicKey(keyPath: string): Promise<string> {
    const { stdout } = await runCommand('openssl', [
      'pkey',
      '-in',
      keyPath,
      '-pubout',
    ]);
    return stdout.trim();
  }

  private getAcmeChallengeDelegate(): {
    findMany?: (args: unknown) => Promise<AcmeChallengeRecord[]>;
    update?: (args: unknown) => Promise<unknown>;
  } | null {
    const delegate = (this.prisma as unknown as {
      acmeChallenge?: {
        findMany?: (args: unknown) => Promise<AcmeChallengeRecord[]>;
        update?: (args: unknown) => Promise<unknown>;
      };
    }).acmeChallenge;

    return delegate ?? null;
  }

  private toAcmeChallengeDto(
    challenge: AcmeChallengeRecord,
  ): AcmeChallengeInfoDto {
    return {
      id: challenge.id,
      orderId: challenge.orderId,
      token: challenge.token,
      domain: challenge.domain,
      challengeType: challenge.challengeType,
      provider: challenge.provider,
      status: challenge.status,
      presentedAt: challenge.presentedAt,
      cleanedUpAt: challenge.cleanedUpAt,
      finalizedAt: challenge.finalizedAt,
      lastServedAt: challenge.lastServedAt,
      expiresAt: challenge.expiresAt,
      metadata: challenge.metadata,
      createdAt: challenge.createdAt,
    };
  }

  private async finalizeAcmeChallengesForOrder(
    orderId: string,
    params: {
      status: 'validated' | 'failed';
      error?: string | null;
    },
  ): Promise<void> {
    const delegate = this.getAcmeChallengeDelegate();
    if (!delegate?.findMany || !delegate.update) {
      return;
    }

    const challenges = await delegate.findMany({
      where: {
        orderId,
        status: {
          in: ['presented', 'cleaned-up'],
        },
      },
      orderBy: [{ presentedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (challenges.length === 0) {
      return;
    }

    const finalizedAt = new Date();
    await Promise.all(
      challenges.map((challenge) =>
        delegate.update?.({
          where: { id: challenge.id },
          data: {
            status: params.status,
            finalizedAt,
            metadata: this.mergeMetadata(challenge.metadata, {
              finalization: {
                status: params.status,
                error: params.error ?? null,
                finalizedAt: finalizedAt.toISOString(),
              },
            }),
          },
        }),
      ),
    );
  }

  private calculateRetryDelayMs(attemptNumber: number): number {
    const cappedAttempt = Math.max(1, attemptNumber);

    return Math.min(
      1000 * 60 * 60 * 24,
      1000 * 60 * 2 ** Math.min(5, cappedAttempt) +
        Math.floor(Math.random() * 30000),
    );
  }

  /**
   * Check Let's Encrypt rate limits before certificate issuance
   * Let's Encrypt limits: 50 certificates per registered domain per week
   * PRODUCTION-GRADE: Prevents hitting API rate limits
   */
  private async checkLetsEncryptRateLimit(
    primaryDomain: string,
  ): Promise<boolean> {
    try {
      // Get the registered domain (e.g., example.com from subdomain.example.com)
      const registeredDomain = this.getRegisteredDomain(primaryDomain);

      // Check certificates issued in the last 7 days for this registered domain
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const recentCertsCount = await this.prisma.certificate.count({
        where: {
          domains: { contains: registeredDomain },
          issuedAt: { gte: weekAgo },
          status: 'active',
        },
      });

      // Let's Encrypt limit is 50 per week, but we'll be conservative and alert at 40
      const SAFE_LIMIT = 40;
      const HARD_LIMIT = 50;

      if (recentCertsCount >= HARD_LIMIT) {
        this.logger.error(
          `[RateLimit] BLOCKED: ${registeredDomain} has ${recentCertsCount} certificates in last 7 days (limit: 50)`,
        );
        return false;
      }

      if (recentCertsCount >= SAFE_LIMIT) {
        this.logger.warn(
          `[RateLimit] WARNING: ${registeredDomain} has ${recentCertsCount} certificates in last 7 days (approaching limit: 50)`,
        );

        // Send warning alert
        await this.alertService
          .sendAlert({
            type: 'warning',
            title: "Let's Encrypt Rate Limit Warning",
            message: `Domain ${registeredDomain} has ${recentCertsCount} certificates issued in the last 7 days. Approaching limit of 50.`,
            metadata: {
              domain: registeredDomain,
              certCount: recentCertsCount,
              limit: HARD_LIMIT,
              instanceId: this.distributedLock.getInstanceId(),
              timestamp: new Date().toISOString(),
            },
          })
          .catch((alertErr) =>
            this.logger.debug(
              `[RateLimit] Failed to send alert: ${alertErr.message}`,
            ),
          );
      } else {
        this.logger.debug(
          `[RateLimit] OK: ${registeredDomain} has ${recentCertsCount} certificates in last 7 days`,
        );
      }

      return true;
    } catch (error) {
      // On error, allow the request to proceed (fail open, not fail closed)
      this.logger.warn(
        `[RateLimit] Error checking rate limit: ${error instanceof Error ? error.message : String(error)}. Allowing request.`,
      );
      return true;
    }
  }

  /**
   * Extract registered domain from FQDN
   * Examples: subdomain.example.com -> example.com, www.example.co.uk -> example.co.uk
   */
  private getRegisteredDomain(domain: string): string {
    const normalizedDomain = normalizeDomain(domain, { allowWildcard: true });
    const hostname = normalizedDomain.startsWith('*.')
      ? normalizedDomain.slice(2)
      : normalizedDomain;
    const parts = hostname.split('.');

    // Handle special TLDs like .co.uk, .com.au, etc.
    const specialTlds = ['co.uk', 'com.au', 'co.nz', 'co.za', 'com.br'];
    const lastTwo = parts.slice(-2).join('.');

    if (specialTlds.includes(lastTwo)) {
      // Return last 3 parts (e.g., example.co.uk)
      return parts.slice(-3).join('.');
    }

    // Return last 2 parts (e.g., example.com)
    return parts.slice(-2).join('.');
  }

  /**
   * Validate certificate integrity and properties
   * PRODUCTION-GRADE: Comprehensive validation before using certificate
   */
  private async validateCertificate(
    certPem: string,
    keyPem: string,
    domains: string[],
  ): Promise<{
    valid: boolean;
    error?: string;
    expiresAt?: Date;
    daysUntilExpiry?: number;
  }> {
    try {
      // 1. Check PEM format
      if (
        !certPem.includes('BEGIN CERTIFICATE') ||
        (!keyPem.includes('BEGIN PRIVATE KEY') &&
          !keyPem.includes('BEGIN RSA PRIVATE KEY'))
      ) {
        return { valid: false, error: 'Invalid PEM format' };
      }

      // 2. Write to temp files for validation
      const tempDir = this.createTempDirectory('lyttlenginx-cert-validation-');

      const tempCertPath = path.join(tempDir, 'cert.pem');
      const tempKeyPath = path.join(tempDir, 'key.pem');

      fs.writeFileSync(tempCertPath, certPem, 'utf8');
      fs.writeFileSync(tempKeyPath, keyPem, 'utf8');

      try {
        // 3. Validate certificate structure
        const certCheck = await runCommand('openssl', [
          'x509',
          '-in',
          tempCertPath,
          '-noout',
          '-text',
        ]);
        if (!certCheck.stdout.trim()) {
          return {
            valid: false,
            error:
              'Certificate validation failed: no certificate data returned',
          };
        }

        // 4. Validate private key and 5. Verify cert and key match
        const certPublicKey = await this.getCertificatePublicKey(tempCertPath);
        const keyPublicKey = await this.getPrivateKeyPublicKey(tempKeyPath);

        if (certPublicKey !== keyPublicKey) {
          return {
            valid: false,
            error: 'Certificate and private key do not match',
          };
        }

        // 6. Check expiry
        const expiryOutput = await runCommand('openssl', [
          'x509',
          '-enddate',
          '-noout',
          '-in',
          tempCertPath,
        ]);
        const match = expiryOutput.stdout.match(/notAfter=(.*)/);
        if (!match) {
          return { valid: false, error: 'Could not parse expiry date' };
        }

        const expiresAt = new Date(match[1]);
        const now = new Date();
        const daysUntilExpiry = Math.floor(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysUntilExpiry < 0) {
          return {
            valid: false,
            error: 'Certificate has expired',
            expiresAt,
            daysUntilExpiry,
          };
        }

        // 7. Verify domains (SAN check)
        const certDomains =
          certCheck.stdout
            .match(/DNS:([^,\s]+)/g)
            ?.map((d) => d.replace('DNS:', '')) || [];

        // Check if all requested domains are in the certificate
        const missingDomains = domains.filter((d) => !certDomains.includes(d));
        if (missingDomains.length > 0) {
          this.logger.warn(
            `Certificate missing domains: ${missingDomains.join(', ')}`,
          );
          // Not a hard failure - Let's Encrypt might have issued for a subset
        }

        return {
          valid: true,
          expiresAt,
          daysUntilExpiry,
        };
      } finally {
        // Cleanup temp files
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          this.logger.warn(
            `Failed to cleanup temp validation files: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          );
        }
      }
    } catch (error) {
      return {
        valid: false,
        error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private writeCertToFs(
    primaryDomain: string,
    certPem: string,
    keyPem: string,
  ) {
    const dir = this.certDir(primaryDomain);
    this.logger.log(`[FS] Ensuring directory exists: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });

    const certPath = path.join(dir, 'fullchain.pem');
    const keyPath = path.join(dir, 'privkey.pem');
    const certTempPath = `${certPath}.tmp`;
    const keyTempPath = `${keyPath}.tmp`;

    try {
      // Write to temp files first (atomic operation)
      this.logger.log(`[FS] Writing certificate to temp file: ${certTempPath}`);
      fs.writeFileSync(certTempPath, certPem, {
        encoding: 'utf8',
        mode: 0o644, // Read for all, write for owner
      });

      this.logger.log(`[FS] Writing private key to temp file: ${keyTempPath}`);
      fs.writeFileSync(keyTempPath, keyPem, {
        encoding: 'utf8',
        mode: 0o600, // Read/write for owner only (security)
      });

      // Validate the certificate and key before moving
      this.logger.debug(`[FS] Validating certificate and key...`);
      const certStat = fs.statSync(certTempPath);
      const keyStat = fs.statSync(keyTempPath);

      if (certStat.size === 0 || keyStat.size === 0) {
        throw new Error('Certificate or key file is empty');
      }

      // Atomic move (rename) - this is atomic on most filesystems
      this.logger.log(
        `[FS] Moving certificate: ${certTempPath} -> ${certPath}`,
      );
      fs.renameSync(certTempPath, certPath);

      this.logger.log(`[FS] Moving private key: ${keyTempPath} -> ${keyPath}`);
      fs.renameSync(keyTempPath, keyPath);

      this.logger.log(
        `[FS] Successfully wrote certificate files for ${primaryDomain}`,
      );
    } catch (error) {
      // Clean up temp files on error
      try {
        if (fs.existsSync(certTempPath)) fs.unlinkSync(certTempPath);
        if (fs.existsSync(keyTempPath)) fs.unlinkSync(keyTempPath);
      } catch (cleanupError) {
        this.logger.warn(
          `[FS] Failed to cleanup temp files: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }

      this.logger.error(
        `[FS] Failed to write certificate files: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private getCertificateActivationTimeoutMs() {
    const parsed = Number.parseInt(
      process.env.CERTIFICATE_ACTIVATION_TIMEOUT_MS ?? '',
      10,
    );

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  private mergeMetadata(
    current: unknown,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    return {
      ...base,
      ...patch,
    };
  }

  private summarizeOperationFailure(operation: {
    status: string;
    acknowledgements: Array<{
      nodeHostname: string | null;
      nodeInstanceId: string;
      errorMessage: string | null;
      status: string;
    }>;
  }) {
    const failures = operation.acknowledgements.filter(
      (ack) => ack.status === 'failed',
    );

    if (failures.length === 0) {
      return `Certificate activation finished with status ${operation.status}`;
    }

    return failures
      .map(
        (ack) =>
          `${ack.nodeHostname ?? ack.nodeInstanceId}: ${ack.errorMessage ?? 'activation failed'}`,
      )
      .join('; ');
  }

  private async activateArtifactLocally(
    artifactId: string,
    operationId?: string,
  ) {
    const artifact = await this.certificateOrders.getArtifact(artifactId);

    if (!artifact) {
      throw new Error(`Certificate artifact not found: ${artifactId}`);
    }

    const domains = parseDomains(artifact.domains, { allowWildcard: true });
    const primaryDomain = domains[0];
    const validation = await this.validateCertificate(
      artifact.certPem,
      artifact.keyPem,
      domains,
    );

    if (!validation.valid) {
      throw new Error(
        `Artifact ${artifactId} failed validation before activation: ${validation.error}`,
      );
    }

    this.writeCertToFs(primaryDomain, artifact.certPem, artifact.keyPem);
    await runCommand('nginx', ['-t']);
    await runCommand('nginx', ['-s', 'reload']);

    return {
      operationId: operationId ?? null,
      artifactId: artifact.id,
      version: artifact.version,
      primaryDomain,
      domains,
      status: 'activated',
    };
  }

  private async activateArtifactAcrossCluster(params: {
    artifactId: string;
    orderId: string;
    action: 'activate' | 'rollback';
  }) {
    const artifact = await this.certificateOrders.getArtifact(params.artifactId);

    if (!artifact) {
      throw new Error(`Certificate artifact not found: ${params.artifactId}`);
    }

    const existingOrder = await this.prisma.certificateOrder.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        attemptCount: true,
      },
    });

    if (!existingOrder) {
      throw new Error(`Certificate order not found: ${params.orderId}`);
    }

    const currentArtifact = await this.certificateOrders.getCurrentArtifactForDomainsHash(
      artifact.domainsHash,
    );
    const actionLabel = params.action === 'rollback' ? 'rollback' : 'activation';

    await this.certificateOrders.transitionOrder(params.orderId, 'distributing', {
      message: `Queued cluster certificate ${actionLabel} for artifact version ${artifact.version}`,
      details: {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        action: params.action,
        previousArtifactId: currentArtifact?.id ?? null,
      },
    });

    const operation = await this.clusterOperations.enqueueBroadcastOperation({
      operationType:
        params.action === 'rollback'
          ? 'certificate.rollback'
          : 'certificate.activate',
      broadcast: true,
      remotePath: `/certificates/artifacts/${artifact.id}/activate`,
      executionTimeoutMs: this.getCertificateActivationTimeoutMs(),
      metadata: {
        orderId: params.orderId,
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        domainsHash: artifact.domainsHash,
        action: params.action,
        previousArtifactId: currentArtifact?.id ?? null,
      },
      localAction: async (operationId) =>
        this.activateArtifactLocally(artifact.id, operationId),
    });

    await this.prisma.certificateArtifactVersion.update({
      where: { id: artifact.id },
      data: {
        distributionOperationId: operation.operationId,
        distributionStatus: 'running',
        distributionCompletedAt: null,
        metadata: this.mergeMetadata(artifact.metadata, {
          latestDistribution: {
            operationId: operation.operationId,
            action: params.action,
            previousArtifactId: currentArtifact?.id ?? null,
            queuedAt: new Date().toISOString(),
          },
        }),
      },
    });

    const settledOperation = await this.clusterOperations.waitForOperationToSettle(
      operation.operationId,
      {
        timeoutMs: this.getCertificateActivationTimeoutMs() + 5000,
      },
    );

    const completedAt = settledOperation.completedAt ?? new Date();

    await this.prisma.certificateArtifactVersion.update({
      where: { id: artifact.id },
      data: {
        distributionStatus: settledOperation.status,
        distributionCompletedAt: completedAt,
      },
    });

    if (settledOperation.status !== 'succeeded') {
      const failureSummary = this.summarizeOperationFailure(settledOperation);
      const retryAfter = new Date(
        Date.now() + this.calculateRetryDelayMs(existingOrder.attemptCount),
      );

      await this.certificateOrders.markFailure(
        params.orderId,
        failureSummary,
        retryAfter,
        {
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          action: params.action,
          operationId: operation.operationId,
          previousArtifactId: currentArtifact?.id ?? null,
          operationStatus: settledOperation.status,
        },
      );

      throw new ArtifactActivationError(failureSummary);
    }

    const activeCertificate = await this.prisma.certificate.findUnique({
      where: { domainsHash: artifact.domainsHash },
    } as any);
    const now = new Date();

    const certificateRecord = activeCertificate
      ? await this.prisma.certificate.update({
          where: { domainsHash: artifact.domainsHash } as any,
          data: {
            domains: artifact.domains,
            certPem: artifact.certPem,
            keyPem: artifact.keyPem,
            expiresAt: artifact.expiresAt,
            issuedAt: artifact.issuedAt,
            lastUsedAt: now,
            isOrphaned: false,
            status: 'active',
            failureReason: null,
            retryAfter: null,
            failureCount: 0,
            issuedByNode: this.distributedLock.getInstanceId(),
          } as any,
        })
      : await this.prisma.certificate.create({
          data: {
            domains: artifact.domains,
            domainsHash: artifact.domainsHash,
            certPem: artifact.certPem,
            keyPem: artifact.keyPem,
            expiresAt: artifact.expiresAt,
            issuedAt: artifact.issuedAt,
            lastUsedAt: now,
            isOrphaned: false,
            status: 'active',
            issuedByNode: this.distributedLock.getInstanceId(),
          },
        });

    await this.prisma.certificateArtifactVersion.updateMany({
      where: {
        domainsHash: artifact.domainsHash,
        id: { not: artifact.id },
      },
      data: {
        isCurrent: false,
      },
    });

    await this.prisma.certificateArtifactVersion.update({
      where: { id: artifact.id },
      data: {
        certificateId: certificateRecord.id,
        activatedAt: now,
        isCurrent: true,
        distributionStatus: settledOperation.status,
        distributionCompletedAt: completedAt,
        metadata: this.mergeMetadata(artifact.metadata, {
          latestDistribution: {
            operationId: operation.operationId,
            action: params.action,
            previousArtifactId: currentArtifact?.id ?? null,
            completedAt: completedAt.toISOString(),
            status: settledOperation.status,
          },
        }),
      },
    });

    await this.certificateOrders.completeWithCertificate(params.orderId, {
      certificateId: certificateRecord.id,
      message:
        params.action === 'rollback'
          ? `Rolled back certificate activation to artifact version ${artifact.version} after cluster ACKs`
          : `Certificate artifact version ${artifact.version} activated across the cluster after node ACKs`,
      details: {
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        action: params.action,
        operationId: operation.operationId,
        previousArtifactId: currentArtifact?.id ?? null,
      },
    });

    return {
      certificate: certificateRecord,
      operationId: operation.operationId,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
    };
  }

  async ensureCertificate(
    domainsInput: string[] | string,
    options: {
      orderId?: string;
      sourceType?: CertificateOrderSourceType;
    } = {},
  ): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      this.logger.log(
        '[Dev] Skipping certificate issuance in development mode.',
      );
      return;
    }

    const sourceType = options.sourceType ?? 'acme';
    const domains = Array.isArray(domainsInput)
      ? normalizeDomains(domainsInput as string[], { allowWildcard: true })
      : parseDomains(domainsInput as string, { allowWildcard: true });
    const primaryDomain = domains[0];
    const hash = hashDomains(domains, { allowWildcard: true });
    const domainsHash = hash;
    const domainsStr = joinDomains(domains, { allowWildcard: true });
    const now = new Date();
    const renewBefore = addDays(now, RENEW_BEFORE_DAYS);
    const instanceId = this.distributedLock.getInstanceId();
    const acmeStrategy = resolveAcmeStrategy(domains);

    const order = await this.certificateOrders.getOrCreateOrder({
      domains,
      sourceType,
      requestedByNode: instanceId,
      existingOrderId: options.orderId,
      metadata: {
        flow: 'certificate.ensure',
        renewBeforeDays: RENEW_BEFORE_DAYS,
        acme: acmeStrategy,
      },
    });

    this.logger.log(
      `[Cert] Ensuring certificate for [${domainsStr}] (hash: ${hash})`,
    );

    // 1. Try DB first (without lock - fast path)
    this.logger.log(
      `[DB] Looking up certificate in DB for hash: ${hash} (expires after ${renewBefore.toISOString()})`,
    );
    let certEntry = await this.prisma.certificate.findFirst({
      where: {
        domainsHash: hash,
        expiresAt: { gt: renewBefore },
        isOrphaned: false,
      },
      orderBy: { expiresAt: 'desc' },
    });

    if (certEntry) {
      this.logger.log(
        `[DB] Found valid certificate (id: ${certEntry.id}, expires: ${certEntry.expiresAt.toISOString()}). Writing to FS.`,
      );
      this.writeCertToFs(primaryDomain, certEntry.certPem, certEntry.keyPem);
      await this.prisma.certificate.update({
        where: { id: certEntry.id },
        data: { lastUsedAt: now },
      });
      this.logger.log(
        `[DB] Updated lastUsedAt for certificate id: ${certEntry.id}`,
      );
      await this.certificateOrders.completeWithCertificate(order.id, {
        certificateId: certEntry.id,
        message: 'Reused existing valid certificate from the database',
        details: {
          reusedExistingCertificate: true,
          expiresAt: certEntry.expiresAt.toISOString(),
        },
      });
      return;
    }

    // 2. Check Let's Encrypt rate limits before attempting issuance
    const rateLimitOk = await this.checkLetsEncryptRateLimit(primaryDomain);
    if (!rateLimitOk) {
      const errorMsg = `Rate limit check failed for ${primaryDomain}. Too many certificates issued recently.`;
      this.logger.error(`[RateLimit] ${errorMsg}`);
      const retryAfter = new Date(
        Date.now() + this.calculateRetryDelayMs(order.attemptCount),
      );

      await this.certificateOrders.markFailure(order.id, errorMsg, retryAfter, {
        rateLimited: true,
        sourceType,
      });

      await this.alertService
        .sendAlert({
          type: 'error',
          title: "Let's Encrypt Rate Limit",
          message: errorMsg,
          metadata: {
            domain: primaryDomain,
            allDomains: domainsStr,
            instanceId,
            timestamp: new Date().toISOString(),
            retryAfter: retryAfter.toISOString(),
          },
        })
        .catch((alertErr) =>
          this.logger.error(
            `[RateLimit] Failed to send alert: ${alertErr.message}`,
          ),
        );

      throw new Error(errorMsg);
    }

    // 3. Need to issue certificate - use distributed lock to prevent conflicts
    const lockName = `cert:issue:${hash}`;
    this.logger.log(
      `[Lock] Attempting to acquire lock for certificate issuance: ${lockName}`,
    );

    const result = await this.distributedLock.withLock(
      lockName,
      async () => {
        // Double-check DB after acquiring lock - another node might have just created it
        this.logger.log(
          `[Lock] Lock acquired. Double-checking if certificate exists in DB...`,
        );
        const recheck = await this.prisma.certificate.findFirst({
          where: {
            domainsHash: hash,
            expiresAt: { gt: renewBefore },
            isOrphaned: false,
          },
          orderBy: { expiresAt: 'desc' },
        });

        if (recheck) {
          this.logger.log(
            `[Lock] Certificate was created by another node (id: ${recheck.id}). Using it.`,
          );
          this.writeCertToFs(primaryDomain, recheck.certPem, recheck.keyPem);
          await this.prisma.certificate.update({
            where: { id: recheck.id },
            data: { lastUsedAt: now },
          });
          await this.certificateOrders.completeWithCertificate(order.id, {
            certificateId: recheck.id,
            message:
              'Another node completed the order before the local issuance lock executed',
            details: {
              reusedExistingCertificate: true,
              lockName,
            },
          });
          return recheck;
        }

        // Still need to issue - proceed with certbot
        this.logger.log(
          `[Certbot] No valid certificate in DB. Running certbot for: [${domainsStr}]`,
        );

        try {
          const acmePlan = buildAcmeCertbotPlan({
            domains,
            adminEmail,
            orderId: order.id,
            instanceId,
          });

          await this.certificateOrders.transitionOrder(
            order.id,
            'challenge-published',
            {
              message:
                'Starting ACME manual challenge publication and certificate issuance',
              details: {
                lockName,
                sourceType,
                acme: acmePlan.metadata,
              },
              data: {
                metadata: this.mergeMetadata(order.metadata, {
                  acme: acmePlan.metadata,
                }),
              },
            },
          );

          this.logger.log(
            `[Certbot] Running ${acmePlan.challengeType} certificate flow for ${primaryDomain} via provider ${acmePlan.provider}`,
          );

          await runCommand('certbot', acmePlan.args, {
            env: acmePlan.env,
            timeoutMs: 10 * 60 * 1000,
          });
          this.logger.log(
            `[Certbot] Successfully obtained/renewed certificate for ${primaryDomain}`,
          );

          await this.finalizeAcmeChallengesForOrder(order.id, {
            status: 'validated',
          });

          await this.certificateOrders.transitionOrder(order.id, 'validating', {
            message:
              'ACME order completed; validating generated certificate artifacts',
            details: {
              acme: acmePlan.metadata,
            },
          });

          // Read the cert/key files produced by certbot
          const certPath = path.join(
            this.certDir(primaryDomain),
            'fullchain.pem',
          );
          const keyPath = path.join(this.certDir(primaryDomain), 'privkey.pem');

          // Verify files exist
          if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            throw new Error(
              `Certificate files not found after certbot execution. Cert: ${fs.existsSync(certPath)}, Key: ${fs.existsSync(keyPath)}`,
            );
          }

          this.logger.log(`[FS] Reading certificate file: ${certPath}`);
          const certPem = fs.readFileSync(certPath, 'utf8');
          this.logger.log(`[FS] Reading key file: ${keyPath}`);
          const keyPem = fs.readFileSync(keyPath, 'utf8');

          // Defensive checks: ensure we actually read PEM content before proceeding
          this.logger.debug(
            `[DB] Read cert length=${certPem.length}, key length=${keyPem.length}`,
          );

          // Ensure PEM markers are present - fail fast with clear log if not
          const certLooksValid =
            typeof certPem === 'string' &&
            certPem.includes('BEGIN CERTIFICATE');
          const keyLooksValid =
            typeof keyPem === 'string' &&
            (keyPem.includes('BEGIN PRIVATE KEY') ||
              keyPem.includes('BEGIN RSA PRIVATE KEY'));

          if (!certLooksValid || !keyLooksValid) {
            this.logger.error(
              `[DB] Invalid or missing PEM data after certbot for ${primaryDomain} — certLooksValid=${certLooksValid}, keyLooksValid=${keyLooksValid}`,
            );
            // Throw to trigger the existing failure path (which records failure & schedules retry)
            throw new Error(
              'Certificate or private key missing/invalid after certbot execution',
            );
          }

          // Validate certificate before saving
          this.logger.log(`[Validate] Validating certificate integrity...`);
          const validation = await this.validateCertificate(
            certPem,
            keyPem,
            domains,
          );

          if (!validation.valid) {
            const errorMsg = `Certificate validation failed: ${validation.error}`;
            this.logger.error(`[Validate] ${errorMsg}`);

            // Send alert about validation failure
            await this.alertService
              .sendAlert({
                type: 'error',
                title: 'Certificate Validation Failed',
                message: errorMsg,
                metadata: {
                  domains: domainsStr,
                  instanceId: this.distributedLock.getInstanceId(),
                  timestamp: new Date().toISOString(),
                  validationError: validation.error,
                },
              })
              .catch((alertErr) =>
                this.logger.error(
                  `[Validate] Failed to send alert: ${alertErr.message}`,
                ),
              );

            throw new Error(errorMsg);
          }

          this.logger.debug(
            `[DB] Certificate validated; expiresAt=${validation.expiresAt}`,
          );

          await this.certificateOrders.transitionOrder(order.id, 'issued', {
            message:
              'Validated certificate and private key produced by ACME flow',
            details: {
              expiresAt: validation.expiresAt?.toISOString() ?? null,
            },
          });

          const artifact = await this.certificateOrders.recordArtifact({
            orderId: order.id,
            certificateId: null,
            domains,
            sourceType,
            certPem,
            keyPem,
            issuedAt: new Date(),
            expiresAt: validation.expiresAt ?? addDays(new Date(), 90),
            activatedAt: null,
            createdByNode: instanceId,
            metadata: {
              activation: 'pending-cluster-rollout',
            },
          });

          const activation = await this.activateArtifactAcrossCluster({
            artifactId: artifact.id,
            orderId: order.id,
            action: 'activate',
          });

          return activation.certificate;
        } catch (err) {
          // Persist failure with backoff
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;

          await this.finalizeAcmeChallengesForOrder(order.id, {
            status: 'failed',
            error: message,
          });

          if (err instanceof ArtifactActivationError) {
            await this.alertService
              .sendAlert({
                type: 'error',
                title: 'Certificate Activation Failed',
                message: `Certificate issuance completed but cluster activation failed for ${domainsStr}: ${message}`,
                metadata: {
                  domains: domainsStr,
                  error: message,
                  stack,
                  instanceId,
                },
              })
              .catch((alertErr) =>
                this.logger.error(
                  `[Certbot] Failed to send alert: ${alertErr.message}`,
                ),
              );

            throw err;
          }

          // Avoid overwriting existing certPem/keyPem with empty strings.
          // If a certificate record already exists for this domainsHash, update failure fields only.
          const existingCert = await this.prisma.certificate.findUnique({
            where: { domainsHash },
          } as any);
          const nextFailureCount = (existingCert?.failureCount ?? 0) + 1;
          const retryAfter = new Date(
            Date.now() + this.calculateRetryDelayMs(order.attemptCount),
          );

          if (existingCert) {
            await this.prisma.certificate.update({
              where: { domainsHash } as any,
              data: {
                status: 'failed',
                failureReason: message,
                retryAfter,
                failureCount: { increment: 1 },
                issuedByNode: instanceId,
              } as any,
            });
          } else {
            // No existing record - create a failed placeholder (certs unknown)
            await this.prisma.certificate.create({
              data: {
                domains: domainsStr,
                domainsHash,
                certPem: '',
                keyPem: '',
                expiresAt: now,
                issuedAt: now,
                lastUsedAt: now,
                isOrphaned: false,
                status: 'failed',
                failureReason: message,
                retryAfter,
                failureCount: 1,
                issuedByNode: instanceId,
              },
            });
          }

          await this.certificateOrders.markFailure(
            order.id,
            message,
            retryAfter,
            {
              failureCount: nextFailureCount,
              lockName,
              sourceType,
              stack,
            },
          );

          await this.alertService
            .sendAlert({
              type: 'error',
              title: 'Certificate Issuance Failed',
              message: `Failed to obtain certificate for ${domainsStr}: ${message}`,
              metadata: {
                domains: domainsStr,
                error: message,
                stack,
                instanceId,
                retryAfter: retryAfter.toISOString(),
              },
            })
            .catch((alertErr) =>
              this.logger.error(
                `[Certbot] Failed to send alert: ${alertErr.message}`,
              ),
            );

          throw err;
        }
      },
      {
        timeoutMs: 10000,
        retryDelayMs: 2000,
        maxRetries: 5,
      },
    );

    if (!result) {
      // Failed to acquire lock after retries - check DB one more time
      this.logger.warn(
        `[Lock] Failed to acquire lock after retries. Checking DB one final time...`,
      );
      certEntry = await this.prisma.certificate.findFirst({
        where: {
          domainsHash: hash,
          expiresAt: { gt: renewBefore },
          isOrphaned: false,
        },
        orderBy: { expiresAt: 'desc' },
      });

      if (certEntry) {
        this.logger.log(
          `[DB] Found certificate created by another node (id: ${certEntry.id}). Using it.`,
        );
        this.writeCertToFs(primaryDomain, certEntry.certPem, certEntry.keyPem);
        await this.certificateOrders.completeWithCertificate(order.id, {
          certificateId: certEntry.id,
          message:
            'Used certificate created by another node after local lock contention',
          details: {
            lockName,
            reusedExistingCertificate: true,
          },
        });
        return;
      }

      const errorMsg = `Failed to acquire lock for certificate issuance and no certificate found in DB`;
      this.logger.error(`[Lock] ${errorMsg}`);
      const retryAfter = new Date(
        Date.now() + this.calculateRetryDelayMs(order.attemptCount),
      );

      await this.certificateOrders.markFailure(order.id, errorMsg, retryAfter, {
        lockName,
        sourceType,
      });

      // Send alert for lock acquisition failure
      await this.alertService
        .sendAlert({
          type: 'error',
          title: 'Certificate Lock Acquisition Failed',
          message: errorMsg,
          metadata: {
            domains: domainsStr,
            lockName,
            instanceId,
            timestamp: new Date().toISOString(),
            retryAfter: retryAfter.toISOString(),
          },
        })
        .catch((alertErr) =>
          this.logger.error(`[Lock] Failed to send alert: ${alertErr.message}`),
        );

      throw new Error(errorMsg);
    }
  }

  async renewAllCertificates() {
    this.logger.log(
      '[Renewal] Starting renewal for all certificate domain groups...',
    );
    const now = new Date();
    const retryableAfter = new Date(now.getTime());

    // Only fetch entries that need SSL certificates (ssl=true)
    const entries = await this.prisma.proxyEntry.findMany({
      where: {
        ssl: true,
      },
    });
    const domainGroups = Array.from(
      new Set<string>(
        entries.map((e) =>
          joinDomains(parseDomains(e.domains, { allowWildcard: true }), {
            allowWildcard: true,
          }),
        ),
      ),
    ).map((group) => parseDomains(group, { allowWildcard: true }));

    this.logger.log(
      `[Renewal] Found ${domainGroups.length} unique domain group(s) to renew.`,
    );

    for (const domains of domainGroups) {
      try {
        this.logger.log(
          `[Renewal] Ensuring certificate for group: [${joinDomains(domains, { allowWildcard: true })}]`,
        );
        await this.ensureCertificate(domains);
      } catch (err) {
        this.logger.error(
          `[Renewal] Error ensuring certificate for domains [${joinDomains(domains, { allowWildcard: true })}]: ${err instanceof Error ? err.stack : String(err)}`,
        );
      }
    }

    // Backoff-aware: retry failed ACME orders whose retry window has opened.
    const retryableOrders = await this.prisma.certificateOrder.findMany({
      where: {
        sourceType: 'acme',
        status: 'failed',
        nextRetryAt: { lte: retryableAfter },
      },
      orderBy: { nextRetryAt: 'asc' },
    });

    for (const order of retryableOrders) {
      try {
        this.logger.log(
          `[Renewal] Retrying failed certificate order ${order.id} for [${order.domains}] (attempt=${order.attemptCount})`,
        );
        await this.retryCertificateOrder(order.id);
      } catch (err) {
        this.logger.error(
          `[Renewal] Retry failed for order ${order.id} [${order.domains}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // After possible renewals, reload nginx
    try {
      this.logger.log('[Renewal] Reloading nginx after cert renewal check...');
      await runCommand('nginx', ['-s', 'reload']);
      this.logger.log('[Renewal] nginx reloaded after cert renewal.');

      // Also trigger cluster reload to be safe
      this.triggerClusterReload().catch((err) =>
        this.logger.error(
          `[Reload] Failed to trigger cluster reload: ${err.message}`,
        ),
      );
    } catch (err) {
      this.logger.error(
        '[Renewal] Failed to reload nginx after cert renewal',
        err,
      );
    }
  }

  /**
   * Upload a custom certificate (e.g., purchased from CA or manually obtained)
   */
  async uploadCertificate(dto: {
    domains: string[];
    certPem: string;
    keyPem: string;
    chainPem?: string;
  }) {
    const domains = normalizeDomains(dto.domains, { allowWildcard: true });
    const instanceId = this.distributedLock.getInstanceId();
    const order = await this.certificateOrders.getOrCreateOrder({
      domains,
      sourceType: 'uploaded',
      requestedByNode: instanceId,
      metadata: {
        flow: 'certificate.upload',
      },
    });
    this.logger.log(
      `[Upload] Uploading custom certificate for domains: [${joinDomains(domains, { allowWildcard: true })}]`,
    );
    const hash = hashDomains(domains, { allowWildcard: true });

    // Validate certificate and key match
    await this.validateCertificateKeyPair(dto.certPem, dto.keyPem);

    // Extract expiry from cert
    const tempDir = this.createTempDirectory('lyttlenginx-upload-cert-');
    const certFile = path.join(tempDir, 'cert.pem');
    fs.writeFileSync(certFile, dto.certPem, 'utf8');
    try {
      const expiresAt = await this.getCertificateExpiryFromFile(certFile);

      // Combine cert with chain if provided
      const fullChainPem = dto.chainPem
        ? `${dto.certPem}\n${dto.chainPem}`
        : dto.certPem;

      await this.certificateOrders.transitionOrder(order.id, 'issued', {
        message: 'Validated uploaded certificate material',
        details: {
          expiresAt: expiresAt.toISOString(),
        },
      });

      const artifact = await this.certificateOrders.recordArtifact({
        orderId: order.id,
        certificateId: null,
        domains,
        sourceType: 'uploaded',
        certPem: fullChainPem,
        keyPem: dto.keyPem,
        issuedAt: new Date(),
        expiresAt,
        activatedAt: null,
        createdByNode: instanceId,
        metadata: {
          activation: 'pending-cluster-rollout',
        },
      });

      const activation = await this.activateArtifactAcrossCluster({
        artifactId: artifact.id,
        orderId: order.id,
        action: 'activate',
      });

      this.logger.log(
        `[Upload] Successfully uploaded certificate (id: ${activation.certificate.id})`,
      );
      return activation.certificate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ArtifactActivationError)) {
        await this.certificateOrders.markFailure(order.id, message, null, {
          sourceType: 'uploaded',
        });
      }
      throw error;
    } finally {
      // Clean up temp file
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Generate a self-signed certificate for testing/development
   */
  async generateSelfSignedCertificate(
    domains: string[],
    options: { orderId?: string } = {},
  ) {
    const normalizedDomains = normalizeDomains(domains, {
      allowWildcard: true,
    });
    const instanceId = this.distributedLock.getInstanceId();
    const order = await this.certificateOrders.getOrCreateOrder({
      domains: normalizedDomains,
      sourceType: 'self-signed',
      requestedByNode: instanceId,
      existingOrderId: options.orderId,
      metadata: {
        flow: 'certificate.generate-self-signed',
      },
    });
    this.logger.log(
      `[Self-Signed] Generating self-signed certificate for domains: [${joinDomains(normalizedDomains, { allowWildcard: true })}]`,
    );
    const hash = hashDomains(normalizedDomains, { allowWildcard: true });
    const primaryDomain = normalizedDomains[0];

    // Generate self-signed certificate using openssl
    const tempDir = this.createTempDirectory('lyttlenginx-self-signed-');
    const keyFile = path.join(tempDir, 'key.pem');
    const certFile = path.join(tempDir, 'cert.pem');

    try {
      // Generate private key
      await runCommand('openssl', ['genrsa', '-out', keyFile, '2048']);

      // Generate certificate
      const sanList = normalizedDomains.map((d) => `DNS:${d}`).join(',');
      await runCommand('openssl', [
        'req',
        '-new',
        '-x509',
        '-key',
        keyFile,
        '-out',
        certFile,
        '-days',
        '365',
        '-subj',
        `/CN=${primaryDomain}`,
        '-addext',
        `subjectAltName=${sanList}`,
      ]);

      const certPem = fs.readFileSync(certFile, 'utf8');
      const keyPem = fs.readFileSync(keyFile, 'utf8');

      await this.certificateOrders.transitionOrder(order.id, 'issued', {
        message: 'Generated self-signed certificate material successfully',
        details: {
          primaryDomain,
        },
      });


      const artifact = await this.certificateOrders.recordArtifact({
        orderId: order.id,
        certificateId: null,
        domains: normalizedDomains,
        sourceType: 'self-signed',
        certPem,
        keyPem,
        issuedAt: new Date(),
        expiresAt: addDays(new Date(), 365),
        activatedAt: null,
        createdByNode: instanceId,
        metadata: {
          activation: 'pending-cluster-rollout',
        },
      });

      const activation = await this.activateArtifactAcrossCluster({
        artifactId: artifact.id,
        orderId: order.id,
        action: 'activate',
      });

      this.logger.log(
        `[Self-Signed] Successfully generated certificate (id: ${activation.certificate.id})`,
      );
      return activation.certificate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ArtifactActivationError)) {
        await this.certificateOrders.markFailure(order.id, message, null, {
          sourceType: 'self-signed',
        });
      }
      throw error;
    } finally {
      // Clean up temp files
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * List all certificates with their status
   */
  async listCertificates() {
    const certs = await this.prisma.certificate.findMany({
      orderBy: { expiresAt: 'asc' },
    });

    return certs.map((cert) => {
      const now = new Date();
      const daysUntilExpiry = Math.ceil(
        (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      let status: 'valid' | 'expiring_soon' | 'expired';
      if (daysUntilExpiry < 0) {
        status = 'expired';
      } else if (daysUntilExpiry <= RENEW_BEFORE_DAYS) {
        status = 'expiring_soon';
      } else {
        status = 'valid';
      }

      return {
        id: cert.id,
        domains: parseDomains(cert.domains, { allowWildcard: true }),
        expiresAt: cert.expiresAt,
        issuedAt: cert.issuedAt,
        lastUsedAt: cert.lastUsedAt,
        isOrphaned: cert.isOrphaned,
        daysUntilExpiry,
        status,
      };
    });
  }

  /**
   * Get certificate info by ID
   */
  async getCertificateInfo(id: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) {
      throw new Error(`Certificate not found: ${id}`);
    }

    const now = new Date();
    const daysUntilExpiry = Math.ceil(
      (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    let status: 'valid' | 'expiring_soon' | 'expired';
    if (daysUntilExpiry < 0) {
      status = 'expired';
    } else if (daysUntilExpiry <= RENEW_BEFORE_DAYS) {
      status = 'expiring_soon';
    } else {
      status = 'valid';
    }

    // Check OCSP support and certificate type
    const certAnalysis = await this.analyzeCertificate(cert.certPem);

    return {
      id: cert.id,
      domains: parseDomains(cert.domains, { allowWildcard: true }),
      expiresAt: cert.expiresAt,
      issuedAt: cert.issuedAt,
      lastUsedAt: cert.lastUsedAt,
      isOrphaned: cert.isOrphaned,
      daysUntilExpiry,
      status,
      hasOcspSupport: certAnalysis.hasOcsp,
      issuer: certAnalysis.issuer,
      certificateType: certAnalysis.type,
    };
  }

  async listCertificateOrders(limit?: number) {
    return this.certificateOrders.listOrders(limit);
  }

  async listAcmeChallenges(options: { status?: string; limit?: number } = {}) {
    const delegate = this.getAcmeChallengeDelegate();
    if (!delegate?.findMany) {
      return {
        count: 0,
        challenges: [] as AcmeChallengeInfoDto[],
      };
    }

    const take = Number.isFinite(options.limit)
      ? Math.min(Math.max(options.limit ?? 25, 1), 100)
      : 25;
    const normalizedStatus = options.status?.trim();
    const challenges = await delegate.findMany({
      where: normalizedStatus
        ? {
            status: normalizedStatus,
          }
        : undefined,
      take,
      orderBy: [{ presentedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      count: challenges.length,
      challenges: challenges.map((challenge) => this.toAcmeChallengeDto(challenge)),
    };
  }

  async getCertificateOrder(orderId: string) {
    return this.certificateOrders.getOrder(orderId);
  }

  async retryCertificateOrder(orderId: string) {
    const order = await this.certificateOrders.validateRetryableOrder(orderId);
    const latestArtifact = await this.certificateOrders.getLatestArtifactForOrder(
      orderId,
    );

    if (order.sourceType === 'uploaded' || order.sourceType === 'imported') {
      if (!latestArtifact) {
        throw new Error(
          `Certificate order ${orderId} cannot be retried automatically for source type ${order.sourceType}`,
        );
      }
    }

    await this.certificateOrders.resumeOrder(orderId, {
      reason: 'Manual operator retry requested',
      force: true,
    });

    if (latestArtifact) {
      await this.activateArtifactAcrossCluster({
        artifactId: latestArtifact.id,
        orderId,
        action: 'activate',
      });

      return this.certificateOrders.getOrder(orderId);
    }

    const domains = parseDomains(order.domains, { allowWildcard: true });

    if (order.sourceType === 'self-signed') {
      await this.generateSelfSignedCertificate(domains, { orderId });
    } else {
      await this.ensureCertificate(domains, {
        orderId,
        sourceType: 'acme',
      });
    }

    return this.certificateOrders.getOrder(orderId);
  }

  /**
   * Analyze a certificate to detect OCSP support and type
   */
  private async analyzeCertificate(certPem: string): Promise<{
    hasOcsp: boolean;
    issuer: string;
    type: 'letsencrypt' | 'self-signed' | 'uploaded' | 'unknown';
  }> {
    try {
      // Write cert to temp file for analysis
      const tempDir = this.createTempDirectory('lyttlenginx-cert-analysis-');
      const tempFile = path.join(tempDir, 'cert.pem');
      fs.writeFileSync(tempFile, certPem);

      // Check for OCSP URI
      let ocspUri = '';
      try {
        const { stdout } = await runCommand('openssl', [
          'x509',
          '-in',
          tempFile,
          '-noout',
          '-ocsp_uri',
        ]);
        ocspUri = stdout.trim();
      } catch {
        // No OCSP URI
      }

      // Check issuer
      let issuer = 'Unknown';
      try {
        const { stdout } = await runCommand('openssl', [
          'x509',
          '-in',
          tempFile,
          '-noout',
          '-issuer',
        ]);
        issuer = stdout.replace('issuer=', '').trim();
      } catch {
        // Could not get issuer
      }

      // Check subject
      let subject = '';
      try {
        const { stdout } = await runCommand('openssl', [
          'x509',
          '-in',
          tempFile,
          '-noout',
          '-subject',
        ]);
        subject = stdout.replace('subject=', '').trim();
      } catch {
        // Could not get subject
      }

      // Clean up temp file
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      // Determine certificate type
      let type: 'letsencrypt' | 'self-signed' | 'uploaded' | 'unknown' =
        'unknown';

      if (
        issuer.includes("Let's Encrypt") ||
        issuer.includes('E1') ||
        issuer.includes('R3')
      ) {
        type = 'letsencrypt';
      } else if (subject === issuer) {
        type = 'self-signed';
      } else if (issuer !== 'Unknown') {
        type = 'uploaded';
      }

      return {
        hasOcsp: ocspUri.length > 0,
        issuer,
        type,
      };
    } catch (error) {
      this.logger.warn(
        `[CertAnalysis] Failed to analyze certificate: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        hasOcsp: false,
        issuer: 'Unknown',
        type: 'unknown',
      };
    }
  }

  /**
   * Renew a specific certificate by ID
   */
  async renewCertificateById(id: string) {
    this.logger.log(`[Renew] Renewing certificate by id: ${id}`);
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) {
      throw new Error(`Certificate not found: ${id}`);
    }

    const domains = parseDomains(cert.domains, { allowWildcard: true });
    await this.ensureCertificate(domains);

    return { message: `Certificate renewal initiated for ${cert.domains}` };
  }

  async activateCertificateArtifact(
    artifactId: string,
    operationId?: string,
  ) {
    return this.activateArtifactLocally(artifactId, operationId);
  }

  async rollbackCertificate(id: string) {
    const certificate = await this.prisma.certificate.findUnique({ where: { id } });

    if (!certificate) {
      throw new Error(`Certificate not found: ${id}`);
    }

    const currentArtifact = await this.certificateOrders.getCurrentArtifactForDomainsHash(
      certificate.domainsHash,
    );

    if (!currentArtifact) {
      throw new Error(
        `No current certificate artifact is recorded for certificate ${id}`,
      );
    }

    const rollbackArtifact =
      await this.certificateOrders.getRollbackArtifactForDomainsHash(
        certificate.domainsHash,
        currentArtifact.version,
      );

    if (!rollbackArtifact) {
      throw new Error(
        `No prior activated artifact version is available to roll back certificate ${id}`,
      );
    }

    const rollbackOrderId = rollbackArtifact.orderId ?? currentArtifact.orderId;

    if (!rollbackOrderId) {
      throw new Error(
        `Rollback artifact ${rollbackArtifact.id} is missing its source order linkage`,
      );
    }

    const activation = await this.activateArtifactAcrossCluster({
      artifactId: rollbackArtifact.id,
      orderId: rollbackOrderId,
      action: 'rollback',
    });

    return {
      ...activation.certificate,
      orderId: rollbackOrderId,
      rollbackFromArtifactId: currentArtifact.id,
      rollbackToArtifactId: rollbackArtifact.id,
      rollbackToVersion: rollbackArtifact.version,
      operationId: activation.operationId,
    };
  }

  /**
   * Delete a certificate
   */
  async deleteCertificate(id: string) {
    this.logger.log(`[Delete] Deleting certificate: ${id}`);
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) {
      throw new Error(`Certificate not found: ${id}`);
    }

    // Delete from filesystem
    const primaryDomain = parseDomains(cert.domains, {
      allowWildcard: true,
    })[0];
    const dir = this.certDir(primaryDomain);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
        this.logger.log(`[Delete] Removed certificate directory: ${dir}`);
      }
    } catch (err) {
      this.logger.warn(
        `[Delete] Failed to remove certificate directory: ${dir}`,
        err,
      );
    }

    // Delete from database
    await this.prisma.certificate.delete({ where: { id } });
    this.logger.log(`[Delete] Deleted certificate from database: ${id}`);
  }

  /**
   * Validate domain ownership for certificate issuance
   */
  async validateDomainForCertificate(domain: string) {
    const normalizedDomain = normalizeDomain(domain);
    this.logger.log(`[Validate] Validating domain: ${normalizedDomain}`);
    // This is a placeholder - in production, you'd check DNS, HTTP challenges, etc.
    // For now, just check if domain resolves
    const { lookup } = await import('dns/promises');
    try {
      await lookup(normalizedDomain);
      return {
        domain: normalizedDomain,
        valid: true,
        message: 'Domain resolves successfully',
      };
    } catch (err) {
      return {
        domain: normalizedDomain,
        valid: false,
        message: `Domain does not resolve: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Validate that certificate and private key match
   */
  private async validateCertificateKeyPair(
    certPem: string,
    keyPem: string,
  ): Promise<void> {
    const tempDir = this.createTempDirectory('lyttlenginx-keypair-validation-');
    const certFile = path.join(tempDir, 'cert.pem');
    const keyFile = path.join(tempDir, 'key.pem');

    try {
      fs.writeFileSync(certFile, certPem, 'utf8');
      fs.writeFileSync(keyFile, keyPem, 'utf8');

      const certPublicKey = await this.getCertificatePublicKey(certFile);
      const keyPublicKey = await this.getPrivateKeyPublicKey(keyFile);

      if (certPublicKey !== keyPublicKey) {
        throw new Error('Certificate and private key do not match');
      }

      this.logger.log('[Validate] Certificate and key pair validated');
    } finally {
      // Clean up temp files
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Check OCSP support for all certificates
   * Useful for identifying certificates that cause NGINX warnings
   */
  async checkAllCertificatesOcspSupport() {
    this.logger.log('[OcspCheck] Checking OCSP support for all certificates');

    const certs = await this.prisma.certificate.findMany({
      where: { isOrphaned: false },
      orderBy: { domains: 'asc' },
    });

    const results = await Promise.all(
      certs.map(async (cert) => {
        const analysis = await this.analyzeCertificate(cert.certPem);
        const domains = parseDomains(cert.domains, { allowWildcard: true });

        return {
          id: cert.id,
          domains: parseDomains(cert.domains, { allowWildcard: true }),
          primaryDomain: domains[0],
          hasOcsp: analysis.hasOcsp,
          certificateType: analysis.type,
          issuer: analysis.issuer,
          expiresAt: cert.expiresAt,
        };
      }),
    );

    const withOcsp = results.filter((r) => r.hasOcsp);
    const withoutOcsp = results.filter((r) => !r.hasOcsp);

    return {
      total: results.length,
      withOcspSupport: withOcsp.length,
      withoutOcspSupport: withoutOcsp.length,
      certificates: results,
      summary: {
        letsencrypt: results.filter((r) => r.certificateType === 'letsencrypt')
          .length,
        selfSigned: results.filter((r) => r.certificateType === 'self-signed')
          .length,
        uploaded: results.filter((r) => r.certificateType === 'uploaded')
          .length,
        unknown: results.filter((r) => r.certificateType === 'unknown').length,
      },
      certificatesWithoutOcsp: withoutOcsp.map((r) => ({
        domains: r.domains,
        type: r.certificateType,
        issuer: r.issuer,
      })),
    };
  }

  /**
   * Trigger a cluster-wide certificate sync via broadcast to all nodes
   * This ensures all nodes immediately pick up new certificates
   * PRODUCTION-GRADE: Proper error handling and fire-and-forget pattern
   */
  private async triggerClusterReload() {
    try {
      const operation = await this.clusterOperations.enqueueBroadcastOperation({
        operationType: 'certificate.sync',
        broadcast: true,
        remotePath: '/certificates/sync',
        initiatedBy: {
          requestPath: '/certificates/sync',
        },
        metadata: {
          source: 'certificate-renewal',
        },
        localAction: async () => {
          const result = await this.syncCertificates();

          if (!result.success) {
            const errorSummary = result.errors
              .map((entry) => `${entry.domain}: ${entry.error}`)
              .join('; ');
            throw new Error(
              errorSummary || 'Certificate synchronization failed',
            );
          }

          return result;
        },
      });

      this.logger.log(
        `[Reload] Queued certificate sync cluster operation ${operation.operationId}`,
      );
    } catch (error) {
      this.logger.warn(
        `[Reload] Failed to trigger cluster reload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
