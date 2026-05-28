import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ReloaderModule } from './reloader/reloader.module';
import { NginxModule } from './nginx/nginx.module';
import { AppService } from './app.service';
import { CertificateModule } from './certificate/certificate.module';
import { HealthModule } from './health/health.module';
import { LogsModule } from './logs/logs.module';

import { RateLimitModule } from './rate-limit/rate-limit.module';
import { MetricsModule } from './metrics/metrics.module';
import { AuthModule } from './auth/auth.module';
import { DistributedLockModule } from './distributed-lock/distributed-lock.module';
import { AuditModule } from './audit/audit.module';
import { ProxyModule } from './proxy/proxy.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    AuditModule,
    AuthModule,
    RateLimitModule,
    MetricsModule,
    PrismaModule,
    DistributedLockModule,
    ProxyModule,
    SecurityModule,
    ReloaderModule,
    NginxModule,
    CertificateModule,
    HealthModule,
    LogsModule,
  ],
  providers: [AppService],
  controllers: [AppController],
})
export class AppModule {
}
