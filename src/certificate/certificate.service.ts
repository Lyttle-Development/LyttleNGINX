import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import * as process from 'node:process';
import * as fs from 'fs';
import * as path from 'path';
import { addDays } from 'date-fns';
import { hashDomains, joinDomains, parseDomains } from '../utils/domain-utils';
import { AlertService } from '../alert/alert.service';
import { DistributedLockService } from '../distributed-lock/distributed-lock.service';

const exec = promisify(execCb);
const adminEmail = process.env.ADMIN_EMAIL || null;
const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

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
    private distributedLock: DistributedLockService,
    @Inject(
      forwardRef(
        () =>
          require('../distributed-lock/cluster-heartbeat.service')
            .ClusterHeartbeatService,
      ),
    )
    private clusterHeartbeat: any,
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
          const domains = parseDomains(cert.domains);
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
          await exec('nginx -t');
          await exec('nginx -s reload');
          this.logger.log('[Sync] NGINX reloaded successfully');
        } catch (reloadErr) {
          const errorMsg =
            reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
          this.logger.error(`[Sync] Failed to reload NGINX: ${errorMsg}`);

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

      return { success: true, syncedCount, errors };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Sync] Certificate synchronization failed: ${errorMsg}`,
      );

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
    return `/etc/letsencrypt/live/${primaryDomain}`;
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
      const tempDir = `/tmp/cert-validation-${Date.now()}`;
      fs.mkdirSync(tempDir, { recursive: true });

      const tempCertPath = path.join(tempDir, 'cert.pem');
      const tempKeyPath = path.join(tempDir, 'key.pem');

      fs.writeFileSync(tempCertPath, certPem, 'utf8');
      fs.writeFileSync(tempKeyPath, keyPem, 'utf8');

      try {
        // 3. Validate certificate structure
        const certCheck = await exec(
          `openssl x509 -in ${tempCertPath} -noout -text 2>&1`,
        );
        if (certCheck.stderr) {
          return {
            valid: false,
            error: `Certificate validation failed: ${certCheck.stderr}`,
          };
        }

        // 4. Validate private key
        const keyCheck = await exec(
          `openssl rsa -in ${tempKeyPath} -check -noout 2>&1`,
        );
        if (keyCheck.stderr && !keyCheck.stderr.includes('ok')) {
          return {
            valid: false,
            error: `Private key validation failed: ${keyCheck.stderr}`,
          };
        }

        // 5. Verify cert and key match
        const certModulus = await exec(
          `openssl x509 -noout -modulus -in ${tempCertPath} | openssl md5`,
        );
        const keyModulus = await exec(
          `openssl rsa -noout -modulus -in ${tempKeyPath} | openssl md5`,
        );

        if (certModulus.stdout.trim() !== keyModulus.stdout.trim()) {
          return {
            valid: false,
            error: 'Certificate and private key do not match',
          };
        }

        // 6. Check expiry
        const expiryOutput = await exec(
          `openssl x509 -enddate -noout -in ${tempCertPath}`,
        );
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
        const sanOutput = await exec(
          `openssl x509 -in ${tempCertPath} -noout -text | grep -A1 "Subject Alternative Name"`,
        );
        const certDomains =
          sanOutput.stdout
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

  async ensureCertificate(domainsInput: string[] | string): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      this.logger.log(
        '[Dev] Skipping certificate issuance in development mode.',
      );
      return;
    }
    const domains = Array.isArray(domainsInput)
      ? domainsInput
      : parseDomains(domainsInput);
    const primaryDomain = domains[0];
    const hash = hashDomains(domains);
    const domainsHash = hash;
    const domainsStr = joinDomains(domains);
    const now = new Date();
    const renewBefore = addDays(now, RENEW_BEFORE_DAYS);

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
      return;
    }

    // 2. Need to issue certificate - use distributed lock to prevent conflicts
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
          return recheck;
        }

        // Still need to issue - proceed with certbot
        this.logger.log(
          `[Certbot] No valid certificate in DB. Running certbot for: [${domainsStr}]`,
        );
        const domainArgs = domains.map((d) => `-d ${d}`).join(' ');

        try {
          // Use shell script hooks that directly interact with PostgreSQL
          // These scripts are copied into the container at /certbot-auth-hook.sh and /certbot-cleanup-hook.sh
          const authHookPath = '/certbot-auth-hook.sh';
          const cleanupHookPath = '/certbot-cleanup-hook.sh';

          // Parse DATABASE_URL to get connection details for psql in the hooks
          const dbUrl = process.env.DATABASE_URL || '';
          const dbMatch = dbUrl.match(
            /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
          );

          if (!dbMatch) {
            const errorMsg =
              'Could not parse DATABASE_URL for certbot hooks. Expected format: postgresql://user:pass@host:port/dbname';
            this.logger.error(`[Certbot] ${errorMsg}`);

            // Send alert for configuration error
            await this.alertService
              .sendAlert({
                type: 'error',
                title: 'Certificate Issuance Configuration Error',
                message: errorMsg,
                metadata: {
                  domains: domainsStr,
                  instanceId: this.distributedLock.getInstanceId(),
                  timestamp: new Date().toISOString(),
                },
              })
              .catch((alertErr) =>
                this.logger.error(
                  `[Certbot] Failed to send alert: ${alertErr.message}`,
                ),
              );

            throw new Error(errorMsg);
          }

          const [, dbUser, dbPassword, dbHost, dbPort, dbName] = dbMatch;

          this.logger.log(
            `[Certbot] Running command: certbot certonly --manual --preferred-challenges=http --manual-auth-hook=${authHookPath} --manual-cleanup-hook=${cleanupHookPath} --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
          );

          // Use manual mode with shell hooks so all nodes can serve challenges from database
          await exec(
            `DB_USER=${dbUser} DB_PASSWORD=${dbPassword} DB_HOST=${dbHost} DB_PORT=${dbPort} DB_NAME=${dbName} certbot certonly --manual --preferred-challenges=http --manual-auth-hook=${authHookPath} --manual-cleanup-hook=${cleanupHookPath} --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
          );
          this.logger.log(
            `[Certbot] Successfully obtained/renewed certificate for ${primaryDomain}`,
          );

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

          this.logger.log(`[DB] Saving certificate to database...`);
          const certRecord = await this.prisma.certificate.upsert({
            where: { domainsHash } as any,
            update: {
              certPem,
              keyPem,
              expiresAt: validation.expiresAt,
              issuedAt: new Date(),
              lastUsedAt: now,
              isOrphaned: false,
              status: 'active',
              failureReason: null,
              retryAfter: null,
              failureCount: 0,
              issuedByNode: this.distributedLock.getInstanceId(),
            } as any,
            create: {
              domains: domainsStr,
              domainsHash,
              certPem,
              keyPem,
              expiresAt: validation.expiresAt,
              issuedAt: new Date(),
              lastUsedAt: now,
              isOrphaned: false,
              status: 'active',
              issuedByNode: this.distributedLock.getInstanceId(),
            } as any,
          });

          this.logger.log(
            `[DB] Certificate saved (id: ${certRecord.id}, expires: ${certRecord.expiresAt.toISOString()}). Writing to FS...`,
          );
          this.writeCertToFs(primaryDomain, certPem, keyPem);
          return certRecord;
        } catch (err) {
          // Persist failure with backoff
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          const failureCountInc = 1;
          const nextRetryMs = Math.min(
            1000 * 60 * 60 * 24,
            1000 * 60 * 2 ** Math.min(5, failureCountInc) +
              Math.floor(Math.random() * 30000),
          );
          const retryAfter = new Date(Date.now() + nextRetryMs);

          await this.prisma.certificate.upsert({
            where: { domainsHash } as any,
            update: {
              status: 'failed',
              failureReason: message,
              retryAfter,
              failureCount: { increment: 1 },
              issuedByNode: this.distributedLock.getInstanceId(),
            } as any,
            create: {
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
              issuedByNode: this.distributedLock.getInstanceId(),
            } as any,
          });

          await this.alertService
            .sendAlert({
              type: 'error',
              title: 'Certificate Issuance Failed',
              message: `Failed to obtain certificate for ${domainsStr}: ${message}`,
              metadata: {
                domains: domainsStr,
                error: message,
                stack,
                instanceId: this.distributedLock.getInstanceId(),
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
        return;
      }

      const errorMsg = `Failed to acquire lock for certificate issuance and no certificate found in DB`;
      this.logger.error(`[Lock] ${errorMsg}`);

      // Send alert for lock acquisition failure
      await this.alertService
        .sendAlert({
          type: 'error',
          title: 'Certificate Lock Acquisition Failed',
          message: errorMsg,
          metadata: {
            domains: domainsStr,
            lockName,
            instanceId: this.distributedLock.getInstanceId(),
            timestamp: new Date().toISOString(),
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
      new Set(entries.map((e) => joinDomains(parseDomains(e.domains)))),
    ).map((group) => parseDomains(group));

    this.logger.log(
      `[Renewal] Found ${domainGroups.length} unique domain group(s) to renew.`,
    );

    for (const domains of domainGroups) {
      try {
        this.logger.log(
          `[Renewal] Ensuring certificate for group: [${joinDomains(domains)}]`,
        );
        await this.ensureCertificate(domains);
      } catch (err) {
        this.logger.error(
          `[Renewal] Error ensuring certificate for domains [${joinDomains(domains)}]: ${err instanceof Error ? err.stack : String(err)}`,
        );
      }
    }

    // Backoff-aware: also retry failed certs whose retryAfter has passed
    const failedCerts = await this.prisma.certificate.findMany({
      where: {
        retryAfter: { lte: retryableAfter },
        isOrphaned: false,
      },
    } as any);

    for (const cert of failedCerts) {
      const domains = parseDomains(cert.domains);
      try {
        this.logger.log(
          `[Renewal] Retrying failed certificate for [${cert.domains}] (failureCount=${(cert as any).failureCount ?? 0})`,
        );
        await this.ensureCertificate(domains);
      } catch (err) {
        this.logger.error(
          `[Renewal] Retry failed for [${cert.domains}]: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // After possible renewals, reload nginx
    try {
      this.logger.log('[Renewal] Reloading nginx after cert renewal check...');
      await exec('nginx -s reload');
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
    this.logger.log(
      `[Upload] Uploading custom certificate for domains: [${joinDomains(dto.domains)}]`,
    );
    const hash = hashDomains(dto.domains);
    const domainsStr = joinDomains(dto.domains);
    const primaryDomain = dto.domains[0];

    // Validate certificate and key match
    await this.validateCertificateKeyPair(dto.certPem, dto.keyPem);

    // Extract expiry from cert
    const certFile = `/tmp/cert-${Date.now()}.pem`;
    fs.writeFileSync(certFile, dto.certPem, 'utf8');
    try {
      const { stdout } = await exec(
        `openssl x509 -enddate -noout -in ${certFile}`,
      );
      const match = stdout.match(/notAfter=(.*)/);
      const expiresAt = match ? new Date(match[1]) : addDays(new Date(), 365);

      // Combine cert with chain if provided
      const fullChainPem = dto.chainPem
        ? `${dto.certPem}\n${dto.chainPem}`
        : dto.certPem;

      // Write to filesystem
      this.writeCertToFs(primaryDomain, fullChainPem, dto.keyPem);

      // Save to database
      const certRecord = await this.prisma.certificate.create({
        data: {
          domains: domainsStr,
          domainsHash: hash,
          certPem: fullChainPem,
          keyPem: dto.keyPem,
          expiresAt,
          issuedAt: new Date(),
          lastUsedAt: new Date(),
          isOrphaned: false,
        },
      });

      this.logger.log(
        `[Upload] Successfully uploaded certificate (id: ${certRecord.id})`,
      );
      return certRecord;
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(certFile);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Generate a self-signed certificate for testing/development
   */
  async generateSelfSignedCertificate(domains: string[]) {
    this.logger.log(
      `[Self-Signed] Generating self-signed certificate for domains: [${joinDomains(domains)}]`,
    );
    const hash = hashDomains(domains);
    const domainsStr = joinDomains(domains);
    const primaryDomain = domains[0];

    // Generate self-signed certificate using openssl
    const keyFile = `/tmp/key-${Date.now()}.pem`;
    const certFile = `/tmp/cert-${Date.now()}.pem`;

    try {
      // Generate private key
      await exec(`openssl genrsa -out ${keyFile} 2048`);

      // Generate certificate
      const sanList = domains.map((d) => `DNS:${d}`).join(',');
      await exec(
        `openssl req -new -x509 -key ${keyFile} -out ${certFile} -days 365 -subj "/CN=${primaryDomain}" -addext "subjectAltName=${sanList}"`,
      );

      const certPem = fs.readFileSync(certFile, 'utf8');
      const keyPem = fs.readFileSync(keyFile, 'utf8');

      // Write to filesystem
      this.writeCertToFs(primaryDomain, certPem, keyPem);

      // Save to database
      const certRecord = await this.prisma.certificate.create({
        data: {
          domains: domainsStr,
          domainsHash: hash,
          certPem,
          keyPem,
          expiresAt: addDays(new Date(), 365),
          issuedAt: new Date(),
          lastUsedAt: new Date(),
          isOrphaned: false,
        },
      });

      this.logger.log(
        `[Self-Signed] Successfully generated certificate (id: ${certRecord.id})`,
      );
      return certRecord;
    } finally {
      // Clean up temp files
      try {
        fs.unlinkSync(keyFile);
        fs.unlinkSync(certFile);
      } catch (e) {
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
        domains: parseDomains(cert.domains),
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
      domains: parseDomains(cert.domains),
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
      const tempFile = `/tmp/cert-${Date.now()}.pem`;
      fs.writeFileSync(tempFile, certPem);

      // Check for OCSP URI
      let ocspUri = '';
      try {
        const { stdout } = await exec(
          `openssl x509 -in ${tempFile} -noout -ocsp_uri`,
        );
        ocspUri = stdout.trim();
      } catch (err) {
        // No OCSP URI
      }

      // Check issuer
      let issuer = 'Unknown';
      try {
        const { stdout } = await exec(
          `openssl x509 -in ${tempFile} -noout -issuer`,
        );
        issuer = stdout.replace('issuer=', '').trim();
      } catch (err) {
        // Could not get issuer
      }

      // Check subject
      let subject = '';
      try {
        const { stdout } = await exec(
          `openssl x509 -in ${tempFile} -noout -subject`,
        );
        subject = stdout.replace('subject=', '').trim();
      } catch (err) {
        // Could not get subject
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch (err) {
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

    const domains = parseDomains(cert.domains);
    await this.ensureCertificate(domains);

    return { message: `Certificate renewal initiated for ${cert.domains}` };
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
    const primaryDomain = parseDomains(cert.domains)[0];
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
    this.logger.log(`[Validate] Validating domain: ${domain}`);
    // This is a placeholder - in production, you'd check DNS, HTTP challenges, etc.
    // For now, just check if domain resolves
    const { lookup } = await import('dns/promises');
    try {
      await lookup(domain);
      return { domain, valid: true, message: 'Domain resolves successfully' };
    } catch (err) {
      return {
        domain,
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
    const certFile = `/tmp/cert-validate-${Date.now()}.pem`;
    const keyFile = `/tmp/key-validate-${Date.now()}.pem`;

    try {
      fs.writeFileSync(certFile, certPem, 'utf8');
      fs.writeFileSync(keyFile, keyPem, 'utf8');

      // Get modulus from cert
      const { stdout: certModulus } = await exec(
        `openssl x509 -noout -modulus -in ${certFile}`,
      );
      // Get modulus from key
      const { stdout: keyModulus } = await exec(
        `openssl rsa -noout -modulus -in ${keyFile}`,
      );

      if (certModulus.trim() !== keyModulus.trim()) {
        throw new Error('Certificate and private key do not match');
      }

      this.logger.log('[Validate] Certificate and key pair validated');
    } finally {
      // Clean up temp files
      try {
        fs.unlinkSync(certFile);
        fs.unlinkSync(keyFile);
      } catch (e) {
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
        const domains = parseDomains(cert.domains);

        return {
          id: cert.id,
          domains,
          primaryDomain: domains[0],
          hasOcspSupport: analysis.hasOcsp,
          certificateType: analysis.type,
          issuer: analysis.issuer,
          expiresAt: cert.expiresAt,
        };
      }),
    );

    const withOcsp = results.filter((r) => r.hasOcspSupport);
    const withoutOcsp = results.filter((r) => !r.hasOcspSupport);

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
      if (!this.clusterHeartbeat) {
        this.logger.warn(
          '[Reload] ClusterHeartbeatService not available, skipping broadcast',
        );
        return;
      }

      const nodes = await this.clusterHeartbeat.getActiveNodes();
      const thisInstanceId = this.distributedLock.getInstanceId();

      const otherNodes = nodes.filter(
        (n) => n.instanceId !== thisInstanceId && n.ipAddress,
      );

      if (otherNodes.length === 0) {
        this.logger.log('[Reload] No other nodes to notify');
        return;
      }

      this.logger.log(
        `[Reload] Broadcasting certificate sync to ${otherNodes.length} other nodes...`,
      );

      // Trigger sync on other nodes using the dedicated sync endpoint
      // Fire and forget - don't wait for responses
      const port = process.env.PORT || 3000;

      await Promise.allSettled(
        otherNodes.map(async (node) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            // Call the sync endpoint on the other node
            const url = `http://${node.ipAddress}:${port}/certificates/sync`;

            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const result = await response.json();
              this.logger.debug(
                `[Reload] Synced ${result.syncedCount || 0} cert(s) on ${node.hostname} (${node.ipAddress})`,
              );
            } else {
              this.logger.warn(
                `[Reload] Sync failed on ${node.hostname}: ${response.statusText}`,
              );
            }
          } catch (e) {
            this.logger.debug(
              `[Reload] Failed to notify ${node.hostname}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }),
      );

      // Also trigger immediate sync on this node
      this.syncCertificates().catch((err) =>
        this.logger.error(`[Reload] Local sync failed: ${err.message}`),
      );
    } catch (error) {
      this.logger.warn(
        `[Reload] Failed to trigger cluster reload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
