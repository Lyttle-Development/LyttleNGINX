import { Module } from '@nestjs/common';
import { CertificateLookupService } from './certificate-lookup.service';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateCleanupService } from './certificate.cleanup.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    CertificateCleanupService,
    CertificateLookupService,
    PrismaService,
  ],
  exports: [CertificateLookupService],
})
export class CertificateModule {}
