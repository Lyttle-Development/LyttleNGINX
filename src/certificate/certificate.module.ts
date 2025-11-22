import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CertificateController } from './certificate.controller';
import { TlsController } from './tls.controller';
import { CertificateCleanupService } from './certificate-cleanup.service';
import { TlsConfigService } from './tls-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [CertificateController, TlsController],
  providers: [
    CertificateService,
    CertificateCleanupService,
    TlsConfigService,
    PrismaService,
  ],
  exports: [CertificateService, TlsConfigService],
})
export class CertificateModule {}
