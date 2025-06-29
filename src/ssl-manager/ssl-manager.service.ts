import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';

const exec = promisify(execCb);
const adminEmail = process.env.ADMIN_EMAIL || null;

@Injectable()
export class SslManagerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SslManagerService.name);
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

  async renewAllCertificates() {
    // Fetch all unique domain groups from your proxy entries
    const entries = await this.prisma.proxyEntry.findMany();
    const domainGroups = Array.from(
      new Set(
        entries.map((e) =>
          e.domains
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .join(','),
        ),
      ),
    ).map((group) => group.split(',').filter(Boolean));
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

  async ensureCertificate(domains: string[]): Promise<void> {
    const primaryDomain = domains[0];
    // TODO: Add logic to check expiry date (optional, certbot renew is safe to call repeatedly)
    this.logger.log(
      `Ensuring Let's Encrypt cert for: ${domains.join(', ')}...`,
    );
    const domainArgs = domains.map((d) => `-d ${d}`).join(' ');
    try {
      await exec(
        `certbot certonly --nginx --non-interactive --agree-tos -m ${adminEmail} ${domainArgs}`,
      );
      this.logger.log(`Obtained/renewed cert for ${primaryDomain}`);
    } catch (err) {
      this.logger.error(`Certbot failed for ${primaryDomain}:`, err);
    }
  }
}
