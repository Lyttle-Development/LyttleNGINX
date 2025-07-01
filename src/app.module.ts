import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ReloaderModule } from './reloader/reloader.module';
import { NginxModule } from './nginx/nginx.module';
import { AppService } from './app.service';
import { SslManagerModule } from './ssl-manager/ssl-manager.module';
import { CertificateModule } from './certificate/certificate.module';

@Module({
  imports: [PrismaModule, ReloaderModule, NginxModule, SslManagerModule, CertificateModule],
  providers: [AppService],
  controllers: [AppController],
})
export class AppModule {}
