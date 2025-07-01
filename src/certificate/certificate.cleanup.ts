import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CertificateService } from './certificate.service';

@Injectable()
export class CertificateCleanup {
  constructor(private readonly certService: CertificateService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanup() {
    await this.certService.cleanupCertificates();
  }
}