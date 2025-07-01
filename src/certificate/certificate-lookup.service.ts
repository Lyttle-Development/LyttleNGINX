import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashDomains, parseDomains } from '../utils/domain-utils';
import { addDays } from 'date-fns';

const RENEW_BEFORE_DAYS = parseInt(process.env.RENEW_BEFORE_DAYS || '30', 10);

@Injectable()
export class CertificateLookupService {
  private readonly logger = new Logger(CertificateLookupService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        `No valid certificate found for domains="${domainsString}" (hash=${domainsHash})`,
      );
    }
    return cert;
  }

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
