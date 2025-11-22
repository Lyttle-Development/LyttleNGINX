import {
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
   */
  private async leaderElectionCheck() {
    try {
      // If we're already the leader, just verify we still hold the lock
      if (this.isCurrentlyLeader) {
        const stillLeader = await this.distributedLock.isLeader();

        if (!stillLeader) {
          this.logger.warn(
            '[Leader] Lost leadership - lock was released or taken',
          );
          this.isCurrentlyLeader = false;

          if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
          }
        } else {
          this.logger.debug('[Leader] Still the leader');
        }
        return;
      }

      // We're not the leader, try to become one
      const acquiredLock = await this.distributedLock.acquireLeaderLock();

      if (acquiredLock) {
        this.logger.log(
          '[Leader] This instance is now the LEADER - starting certificate renewal',
        );
        this.isCurrentlyLeader = true;

        // Start renewal interval
        if (!this.interval) {
          this.interval = setInterval(
            () => this.renewAllCertificates(),
            this.renewIntervalMs,
          );
          // Also run immediately
          await this.renewAllCertificates();
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
    }
  }

  private certDir(primaryDomain: string) {
    return `/etc/letsencrypt/live/${primaryDomain}`;
  }

  private writeCertToFs(
    primaryDomain: string,
    certPem: string,
    keyPem: string,
  ) {
    const dir = this.certDir(primaryDomain);
    this.logger.log(`[FS] Ensuring directory exists: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });

    this.logger.log(
      `[FS] Writing certificate: ${path.join(dir, 'fullchain.pem')}`,
    );
    fs.writeFileSync(path.join(dir, 'fullchain.pem'), certPem, {
      encoding: 'utf8',
    });

    this.logger.log(
      `[FS] Writing private key: ${path.join(dir, 'privkey.pem')}`,
    );
    fs.writeFileSync(path.join(dir, 'privkey.pem'), keyPem, {
      encoding: 'utf8',
    });
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
          // Create Node.js-based auth hook script that stores challenges in database
          const authHookScript = `
#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
});

async function storeChallenge() {
  try {
    const token = process.env.CERTBOT_TOKEN;
    const validation = process.env.CERTBOT_VALIDATION;
    const domain = process.env.CERTBOT_DOMAIN;
    
    if (!token || !validation || !domain) {
      console.error('Missing required environment variables');
      process.exit(1);
    }
    
    console.log(\`[Auth Hook] Storing challenge for domain: \${domain}\`);
    
    await prisma.acmeChallenge.upsert({
      where: { token },
      create: {
        token,
        keyAuth: validation,
        domain,
        expiresAt: new Date(Date.now() + 3600000) // 1 hour
      },
      update: {
        keyAuth: validation,
        domain,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
    
    console.log(\`[Auth Hook] Challenge stored successfully: \${token}\`);
    await prisma.$disconnect();
    
    // Give Let's Encrypt time to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.exit(0);
  } catch (error) {
    console.error('[Auth Hook] Error storing challenge:', error);
    process.exit(1);
  }
}

storeChallenge();
`;

          const cleanupHookScript = `
#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL
});

async function cleanupChallenge() {
  try {
    const token = process.env.CERTBOT_TOKEN;
    
    if (!token) {
      console.error('Missing CERTBOT_TOKEN');
      process.exit(1);
    }
    
    console.log(\`[Cleanup Hook] Removing challenge: \${token}\`);
    
    await prisma.acmeChallenge.deleteMany({
      where: { token }
    });
    
    console.log('[Cleanup Hook] Challenge removed successfully');
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[Cleanup Hook] Error removing challenge:', error);
    process.exit(1);
  }
}

cleanupChallenge();
`;

          // Write temporary hook scripts
          const authHookPath = '/tmp/certbot-auth-hook.js';
          const cleanupHookPath = '/tmp/certbot-cleanup-hook.js';

          fs.writeFileSync(authHookPath, authHookScript, { mode: 0o755 });
          fs.writeFileSync(cleanupHookPath, cleanupHookScript, { mode: 0o755 });

          this.logger.log(
            `[Certbot] Running command: certbot certonly --manual --preferred-challenges=http --manual-auth-hook=${authHookPath} --manual-cleanup-hook=${cleanupHookPath} --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
          );

          // Use manual mode with Node.js hooks so all nodes can serve challenges from database
          await exec(
            `certbot certonly --manual --preferred-challenges=http --manual-auth-hook=${authHookPath} --manual-cleanup-hook=${cleanupHookPath} --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
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
          this.logger.log(`[FS] Reading certificate file: ${certPath}`);
          const certPem = fs.readFileSync(certPath, 'utf8');
          this.logger.log(`[FS] Reading key file: ${keyPath}`);
          const keyPem = fs.readFileSync(keyPath, 'utf8');

          // Extract expiry from cert
          this.logger.log(
            `[OpenSSL] Extracting expiry from certificate file: ${certPath}`,
          );
          const { stdout } = await exec(
            `openssl x509 -enddate -noout -in ${certPath}`,
          );
          const match = stdout.match(/notAfter=(.*)/);
          const expiresAt = match
            ? new Date(match[1])
            : addDays(new Date(), 90);
          this.logger.log(
            `[OpenSSL] Certificate expiry: ${expiresAt.toISOString()}`,
          );

          const certRecord = await this.prisma.certificate.create({
            data: {
              domains: domainsStr,
              domainsHash: hash,
              certPem,
              keyPem,
              expiresAt,
              issuedAt: new Date(),
              lastUsedAt: now,
              isOrphaned: false,
            },
          });
          this.logger.log(
            `[DB] Saved new certificate to DB (id: ${certRecord.id}, expires: ${expiresAt.toISOString()})`,
          );
          return certRecord;
        } catch (err) {
          this.logger.error(
            `[Certbot] Failed to obtain certificate for ${primaryDomain}: ${err instanceof Error ? err.stack : String(err)}`,
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

      throw new Error(
        `Failed to acquire lock for certificate issuance and no certificate found in DB`,
      );
    }
  }

  async renewAllCertificates() {
    this.logger.log(
      '[Renewal] Starting renewal for all certificate domain groups...',
    );
    const entries = await this.prisma.proxyEntry.findMany();
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
    // After possible renewals, reload nginx
    try {
      this.logger.log('[Renewal] Reloading nginx after cert renewal check...');
      await exec('nginx -s reload');
      this.logger.log('[Renewal] nginx reloaded after cert renewal.');
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
}
