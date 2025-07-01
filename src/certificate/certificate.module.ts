import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CertificateLookupService } from './certificate-lookup.service';
import { CertificateCleanupService } from './certificate-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    CertificateService,
    CertificateLookupService,
    CertificateCleanupService,
    PrismaService,
  ],
  exports: [CertificateService, CertificateLookupService],
})
export class CertificateModule {}
