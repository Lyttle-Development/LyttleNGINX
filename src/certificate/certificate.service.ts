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

const exec = promisify(execCb);
const adminEmail = process.env.ADMIN_EMAIL || null;
const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

@Injectable()
export class CertificateService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CertificateService.name);
  private interval: NodeJS.Timeout | null = null;
  private readonly renewIntervalMs = 1000 * 60 * 60 * 12; // 12 hours

  constructor(private prisma: PrismaService) {}

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
}
