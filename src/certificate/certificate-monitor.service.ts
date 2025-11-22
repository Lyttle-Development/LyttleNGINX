import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AlertService } from '../alert/alert.service';
import { parseDomains } from '../utils/domain-utils';
import * as process from 'node:process';

const ALERT_THRESHOLD_DAYS = parseInt(
  process.env.ALERT_THRESHOLD_DAYS || '14',
  10,
);

@Injectable()
export class CertificateMonitorService implements OnModuleInit {
  private readonly logger = new Logger(CertificateMonitorService.name);

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
  ) {}

  async onModuleInit() {
    this.logger.log('[Monitor] Certificate monitoring service initialized');
    // Run initial check after startup
    setTimeout(() => this.checkCertificateHealth(), 60000); // 1 minute delay
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkCertificateHealth() {
    this.logger.log('[Monitor] Running certificate health check...');

    try {
      const certificates = await this.prisma.certificate.findMany({
        where: { isOrphaned: false },
      });

      const now = new Date();
      let expiringCount = 0;
      let expiredCount = 0;

      for (const cert of certificates) {
        const daysUntilExpiry = Math.ceil(
          (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const domains = parseDomains(cert.domains);

        if (daysUntilExpiry < 0) {
          // Certificate has expired
          expiredCount++;
          this.logger.error(
            `[Monitor] EXPIRED: ${domains[0]} expired ${Math.abs(daysUntilExpiry)} days ago`,
          );
          await this.alertService.sendCertificateExpiredAlert(
            domains,
            cert.expiresAt,
          );
        } else if (daysUntilExpiry <= ALERT_THRESHOLD_DAYS) {
          // Certificate is expiring soon
          expiringCount++;
          this.logger.warn(
            `[Monitor] EXPIRING SOON: ${domains[0]} expires in ${daysUntilExpiry} days`,
          );
          await this.alertService.sendCertificateExpiringAlert(
            domains,
            daysUntilExpiry,
            cert.expiresAt,
          );
        }
      }

      this.logger.log(
        `[Monitor] Health check complete. Total: ${certificates.length}, Expiring: ${expiringCount}, Expired: ${expiredCount}`,
      );
    } catch (error) {
      this.logger.error(
        '[Monitor] Failed to check certificate health',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async getCertificateHealthSummary() {
    const certificates = await this.prisma.certificate.findMany({
      where: { isOrphaned: false },
    });

    const now = new Date();
    const summary = {
      total: certificates.length,
      valid: 0,
      expiringSoon: 0,
      expired: 0,
      certificates: certificates.map((cert) => {
        const daysUntilExpiry = Math.ceil(
          (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        let status: 'valid' | 'expiring_soon' | 'expired';

        if (daysUntilExpiry < 0) {
          status = 'expired';
          summary.expired++;
        } else if (daysUntilExpiry <= ALERT_THRESHOLD_DAYS) {
          status = 'expiring_soon';
          summary.expiringSoon++;
        } else {
          status = 'valid';
          summary.valid++;
        }

        return {
          id: cert.id,
          domains: parseDomains(cert.domains),
          expiresAt: cert.expiresAt,
          daysUntilExpiry,
          status,
        };
      }),
    };

    return summary;
  }
}
