import { Module } from '@nestjs/common';
import { ReloaderService } from './reloader.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NginxModule } from '../nginx/nginx.module';
import { NginxService } from '../nginx/nginx.service';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateService } from '../certificate/certificate.service';
import { TlsConfigService } from '../certificate/tls-config.service';
import { CertificateModule } from '../certificate/certificate.module';

@Module({
  imports: [PrismaModule, NginxModule, CertificateModule],
  providers: [
    ReloaderService,
    NginxService,
    PrismaService,
    CertificateService,
    TlsConfigService,
  ],
  exports: [ReloaderService],
})
export class ReloaderModule {}
