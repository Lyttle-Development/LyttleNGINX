import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CertificateCleanupService } from './certificate-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CertificateService, CertificateCleanupService, PrismaService],
  exports: [CertificateService],
})
export class CertificateModule {}
