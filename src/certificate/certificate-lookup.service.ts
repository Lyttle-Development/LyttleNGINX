import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashDomains, parseDomains } from '../utils/domain-utils';
import { addDays } from 'date-fns';

const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

@Injectable()
export class CertificateLookupService {
  private readonly logger = new Logger(CertificateLookupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Find the non-expiring certificate for this ProxyEntry domain set */
  async findValidCertificateForDomains(domainsString: string) {
    const domainsArr = parseDomains(domainsString);
    if (domainsArr.length === 0) return null;
    const domainsHash = hashDomains(domainsArr);
    const renewThreshold = addDays(new Date(), RENEW_BEFORE_DAYS);

    const cert = await this.prisma.certificate.findFirst({
      where: {
        domainsHash,
        expiresAt: { gt: renewThreshold },
        isOrphaned: false,
      },
      orderBy: { expiresAt: 'desc' },
    });

    if (!cert) {
      this.logger.warn(
        'No valid certificate found',
        '',
        JSON.stringify({
          domains: domainsString,
          hash: domainsHash,
          at: new Date().toISOString(),
        }),
      );
    } else {
      this.logger.log(
        'Valid certificate found',
        JSON.stringify({
          certId: cert.id,
          domains: domainsString,
          expiresAt: cert.expiresAt,
        }),
      );
    }
    return cert;
  }

  /** For debugging: find certificates that don't match any current ProxyEntry */
  async findOrphanCertificates() {
    const entries = await this.prisma.proxyEntry.findMany();
    const usedDomainHashes = new Set(
      entries.map((e) => hashDomains(parseDomains(e.domains))),
    );
    const orphans = await this.prisma.certificate.findMany({
      where: { domainsHash: { notIn: Array.from(usedDomainHashes) } },
    });
    return orphans;
  }
}
