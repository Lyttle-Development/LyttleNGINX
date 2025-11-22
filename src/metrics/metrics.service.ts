import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async getCertificateMetrics() {
    const certificates = await this.prisma.certificate.findMany({
      where: { isOrphaned: false },
    });

    const now = new Date();
    const metrics = {
      total: certificates.length,
      valid: 0,
      expiringSoon: 0,
      expired: 0,
      avgDaysUntilExpiry: 0,
      oldestExpiry: null as Date | null,
      newestExpiry: null as Date | null,
    };

    let totalDays = 0;

    certificates.forEach((cert) => {
      const daysUntilExpiry = Math.ceil(
        (cert.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      totalDays += daysUntilExpiry;

      if (daysUntilExpiry < 0) {
        metrics.expired++;
      } else if (daysUntilExpiry <= 30) {
        metrics.expiringSoon++;
      } else {
        metrics.valid++;
      }

      if (!metrics.oldestExpiry || cert.expiresAt < metrics.oldestExpiry) {
        metrics.oldestExpiry = cert.expiresAt;
      }
      if (!metrics.newestExpiry || cert.expiresAt > metrics.newestExpiry) {
        metrics.newestExpiry = cert.expiresAt;
      }
    });

    metrics.avgDaysUntilExpiry =
      certificates.length > 0 ? Math.round(totalDays / certificates.length) : 0;

    return metrics;
  }

  async getProxyMetrics() {
    const entries = await this.prisma.proxyEntry.findMany();
    return {
      total: entries.length,
      withSsl: entries.filter((e) => e.ssl).length,
      withoutSsl: entries.filter((e) => !e.ssl).length,
      proxies: entries.filter((e) => e.type === 'PROXY').length,
      redirects: entries.filter((e) => e.type === 'REDIRECT').length,
    };
  }

  formatPrometheusMetrics(data: { certificates: any; proxies: any }): string {
    const lines = [
      '# HELP lyttle_certificates_total Total number of certificates',
      '# TYPE lyttle_certificates_total gauge',
      `lyttle_certificates_total ${data.certificates.total}`,
      '',
      '# HELP lyttle_certificates_valid Number of valid certificates',
      '# TYPE lyttle_certificates_valid gauge',
      `lyttle_certificates_valid ${data.certificates.valid}`,
      '',
      '# HELP lyttle_certificates_expiring_soon Number of certificates expiring soon',
      '# TYPE lyttle_certificates_expiring_soon gauge',
      `lyttle_certificates_expiring_soon ${data.certificates.expiringSoon}`,
      '',
      '# HELP lyttle_certificates_expired Number of expired certificates',
      '# TYPE lyttle_certificates_expired gauge',
      `lyttle_certificates_expired ${data.certificates.expired}`,
      '',
      '# HELP lyttle_certificates_avg_days_until_expiry Average days until certificate expiry',
      '# TYPE lyttle_certificates_avg_days_until_expiry gauge',
      `lyttle_certificates_avg_days_until_expiry ${data.certificates.avgDaysUntilExpiry}`,
      '',
      '# HELP lyttle_proxy_entries_total Total number of proxy entries',
      '# TYPE lyttle_proxy_entries_total gauge',
      `lyttle_proxy_entries_total ${data.proxies.total}`,
      '',
      '# HELP lyttle_proxy_entries_ssl Number of proxy entries with SSL',
      '# TYPE lyttle_proxy_entries_ssl gauge',
      `lyttle_proxy_entries_ssl ${data.proxies.withSsl}`,
      '',
    ];

    return lines.join('\n');
  }
}
