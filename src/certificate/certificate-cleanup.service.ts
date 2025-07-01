import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CertificateCleanupService {
  private readonly logger = new Logger(CertificateCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupCertificates() {
    this.logger.log('Starting daily certificate cleanup...');
    const now = new Date();

    // Delete expired certificates
    const expired = await this.prisma.certificate.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (expired.count > 0) {
      this.logger.log(`Deleted ${expired.count} expired certificates.`);
    }

    // Delete orphaned certificates
    const orphans = await this.prisma.certificate.deleteMany({
      where: { isOrphaned: true },
    });
    if (orphans.count > 0) {
      this.logger.log(`Deleted ${orphans.count} orphaned certificates.`);
    }
  }
}
