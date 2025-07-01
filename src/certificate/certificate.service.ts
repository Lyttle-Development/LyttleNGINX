import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDays } from 'date-fns';
import { Certificate } from '@prisma/client';
import { hashDomains, joinDomains } from '../utils/domain-utils';

const RENEW_BEFORE_DAYS = 30; // Can be loaded from config

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getValidCertificate(domains: string[]): Promise<Certificate | null> {
    const hash = hashDomains(domains);
    const now = new Date();
    const renewBefore = addDays(now, RENEW_BEFORE_DAYS);

    // Find cert not expiring soon, matching domains exactly
    const cert = await this.prisma.certificate.findFirst({
      where: {
        domainsHash: hash,
        expiresAt: { gt: renewBefore },
        isOrphaned: false,
      },
      orderBy: { expiresAt: 'desc' },
    });

    if (cert) {
      await this.prisma.certificate.update({
        where: { id: cert.id },
        data: { lastUsedAt: now },
      });
    }
    return cert;
  }

  async saveCertificate(
    domains: string[],
    certPem: string,
    keyPem: string,
    expiresAt: Date,
    issuedAt: Date,
  ): Promise<Certificate> {
    const hash = hashDomains(domains);
    return this.prisma.certificate.create({
      data: {
        domains: joinDomains(domains),
        domainsHash: hash,
        certPem,
        keyPem,
        expiresAt,
        issuedAt,
        lastUsedAt: new Date(),
        isOrphaned: false,
      },
    });
  }

  async orphanOldCertificates(currentDomainsList: string[][]) {
    // Mark as orphaned any certs whose domainsHash isn't in use anymore
    const validHashes = new Set(currentDomainsList.map(hashDomains));
    await this.prisma.certificate.updateMany({
      where: {
        domainsHash: { notIn: Array.from(validHashes) },
        isOrphaned: false,
      },
      data: { isOrphaned: true },
    });
  }

  async cleanupCertificates() {
    // Remove orphaned or expired certs
    const now = new Date();
    await this.prisma.certificate.deleteMany({
      where: {
        OR: [{ isOrphaned: true }, { expiresAt: { lt: now } }],
      },
    });
  }
}
