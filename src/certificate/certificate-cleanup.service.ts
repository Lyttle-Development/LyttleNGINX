import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { hashDomains, parseDomains } from '../utils/domain-utils';

@Injectable()
export class CertificateCleanupService {
  private readonly logger = new Logger(CertificateCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupCertificates() {
    this.logger.log('Starting daily certificate cleanup...');

    // 1. Build set of all domainsHashes currently in use by ProxyEntry
    this.logger.log('Fetching all ProxyEntry domain hashes...');
    const entries = await this.prisma.proxyEntry.findMany();
    const usedDomainHashes = new Set(
      entries.map((e) => hashDomains(parseDomains(e.domains))),
    );
    this.logger.log(
      `Found ${usedDomainHashes.size} unique ProxyEntry domain hashes in use.`,
    );

    // 2. Mark all certificates as orphaned or not
    this.logger.log('Updating orphaned status for all certificates...');
    const allCerts = await this.prisma.certificate.findMany();
    let markedOrphaned = 0,
      markedNotOrphaned = 0;
    for (const cert of allCerts) {
      const shouldBeOrphaned = !usedDomainHashes.has(cert.domainsHash);
      if (cert.isOrphaned !== shouldBeOrphaned) {
        await this.prisma.certificate.update({
          where: { id: cert.id },
          data: { isOrphaned: shouldBeOrphaned },
        });
        if (shouldBeOrphaned) markedOrphaned++;
        else markedNotOrphaned++;
      }
    }
    this.logger.log(
      `Marked ${markedOrphaned} certificates as orphaned, ${markedNotOrphaned} as NOT orphaned.`,
    );

    // 3. Delete expired certificates
    this.logger.log('Deleting expired certificates...');
    const now = new Date();
    const expired = await this.prisma.certificate.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (expired.count > 0) {
      this.logger.log(`Deleted ${expired.count} expired certificates.`);
    }

    // 4. Delete orphaned certificates
    this.logger.log('Deleting certificates marked as orphaned...');
    const orphans = await this.prisma.certificate.deleteMany({
      where: { isOrphaned: true },
    });
    if (orphans.count > 0) {
      this.logger.log(`Deleted ${orphans.count} orphaned certificates.`);
    }

    this.logger.log('Certificate cleanup complete.');
  }
}
