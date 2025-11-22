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

const exec = promisify(execCb);
const adminEmail = process.env.ADMIN_EMAIL || null;
const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

@Injectable()
export class CertificateService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CertificateService.name);
  private interval: NodeJS.Timeout | null = null;
  private readonly renewIntervalMs = 1000 * 60 * 60 * 12; // 12 hours

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      `[Init] Starting certificate renewal interval (${this.renewIntervalMs / (1000 * 60)} min)`,
    );
    this.interval = setInterval(
      () => this.renewAllCertificates(),
      this.renewIntervalMs,
    );
  }

  async onApplicationShutdown() {
    if (this.interval) {
      this.logger.log('[Shutdown] Clearing renewal interval');
      clearInterval(this.interval);
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

    // 1. Try DB
    this.logger.log(
      `[DB] Looking up certificate in DB for hash: ${hash} (expires after ${renewBefore.toISOString()})`,
    );
    const certEntry = await this.prisma.certificate.findFirst({
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

    // 2. Not in DB (or expiring): run certbot, then save in DB
    this.logger.log(
      `[Certbot] No valid certificate in DB. Running certbot for: [${domainsStr}]`,
    );
    const domainArgs = domains.map((d) => `-d ${d}`).join(' ');
    try {
      this.logger.log(
        `[Certbot] Running command: certbot certonly --nginx --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
      );
      await exec(
        `certbot certonly --nginx --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
      );
      this.logger.log(
        `[Certbot] Successfully obtained/renewed certificate for ${primaryDomain}`,
      );

      // Read the cert/key files produced by certbot
      const certPath = path.join(this.certDir(primaryDomain), 'fullchain.pem');
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
      const expiresAt = match ? new Date(match[1]) : addDays(new Date(), 90);
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
    } catch (err) {
      this.logger.error(
        `[Certbot] Failed to obtain certificate for ${primaryDomain}: ${err instanceof Error ? err.stack : String(err)}`,
      );
      throw err;
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
}
