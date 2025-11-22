import { Module } from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CertificateController } from './certificate.controller';
import { TlsController } from './tls.controller';
import { BackupController } from './backup.controller';
import { AcmeController } from './acme.controller';
import { CertificateCleanupService } from './certificate-cleanup.service';
import { CertificateMonitorService } from './certificate-monitor.service';
import { CertificateBackupService } from './certificate-backup.service';
import { TlsConfigService } from './tls-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleModule } from '@nestjs/schedule';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [ScheduleModule.forRoot(), AlertModule],
  controllers: [
    CertificateController,
    TlsController,
    BackupController,
    AcmeController,
  ],
  providers: [
    CertificateService,
    CertificateCleanupService,
    CertificateMonitorService,
    CertificateBackupService,
    TlsConfigService,
    PrismaService,
  ],
  exports: [CertificateService, TlsConfigService],
})
export class CertificateModule {}
