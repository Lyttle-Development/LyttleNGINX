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
    this.interval = setInterval(
      () => this.renewAllCertificates(),
      this.renewIntervalMs,
    );
  }

  async onApplicationShutdown() {
    if (this.interval) clearInterval(this.interval);
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
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fullchain.pem'), certPem, {
      encoding: 'utf8',
    });
    fs.writeFileSync(path.join(dir, 'privkey.pem'), keyPem, {
      encoding: 'utf8',
    });
  }

  async ensureCertificate(domainsInput: string[] | string): Promise<void> {
    if (process.env.NODE_ENV === 'development') return;
    const domains = Array.isArray(domainsInput)
      ? domainsInput
      : parseDomains(domainsInput);
    const primaryDomain = domains[0];
    const hash = hashDomains(domains);
    const domainsStr = joinDomains(domains);
    const now = new Date();
    const renewBefore = addDays(now, RENEW_BEFORE_DAYS);

    // 1. Try DB
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
        `[DB] Found valid cert for ${domainsStr}. Writing to FS.`,
      );
      this.writeCertToFs(primaryDomain, certEntry.certPem, certEntry.keyPem);
      await this.prisma.certificate.update({
        where: { id: certEntry.id },
        data: { lastUsedAt: now },
      });
      return;
    }

    // 2. Not in DB (or expiring): run certbot, then save in DB
    this.logger.log(
      `[Certbot] Ensuring Let's Encrypt cert for: ${domainsStr}...`,
    );
    const domainArgs = domains.map((d) => `-d ${d}`).join(' ');
    try {
      await exec(
        `certbot certonly --nginx --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
      );
      this.logger.log(`[Certbot] Obtained/renewed cert for ${primaryDomain}`);

      // Read the cert/key files produced by certbot
      const certPem = fs.readFileSync(
        path.join(this.certDir(primaryDomain), 'fullchain.pem'),
        'utf8',
      );
      const keyPem = fs.readFileSync(
        path.join(this.certDir(primaryDomain), 'privkey.pem'),
        'utf8',
      );

      // Extract expiry from cert
      const { stdout } = await exec(
        `openssl x509 -enddate -noout -in ${path.join(this.certDir(primaryDomain), 'fullchain.pem')}`,
      );
      const match = stdout.match(/notAfter=(.*)/);
      const expiresAt = match ? new Date(match[1]) : addDays(new Date(), 90);

      await this.prisma.certificate.create({
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
    } catch (err) {
      this.logger.error(`[Certbot] Failed for ${primaryDomain}:`, err);
      throw err;
    }
  }

  async renewAllCertificates() {
    const entries = await this.prisma.proxyEntry.findMany();
    const domainGroups = Array.from(
      new Set(entries.map((e) => joinDomains(parseDomains(e.domains)))),
    ).map((group) => parseDomains(group));
    for (const domains of domainGroups) {
      await this.ensureCertificate(domains);
    }
    // After possible renewals, reload nginx
    try {
      await exec('nginx -s reload');
      this.logger.log('Nginx reloaded after cert renewal check.');
    } catch (err) {
      this.logger.error('Failed to reload nginx after cert renewal', err);
    }
  }
}
