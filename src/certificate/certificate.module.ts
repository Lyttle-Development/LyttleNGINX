import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CertificateService } from './certificate.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CertificateService],
  exports: [CertificateService],
})
export class CertificateModule {}
