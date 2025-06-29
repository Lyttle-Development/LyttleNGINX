import { Module } from '@nestjs/common';
import { ReloaderService } from './reloader.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NginxModule } from '../nginx/nginx.module';
import { NginxService } from '../nginx/nginx.service';
import { PrismaService } from '../prisma/prisma.service';
import { SslManagerService } from '../ssl-manager/ssl-manager.service';
import { SslManagerModule } from '../ssl-manager/ssl-manager.module';

@Module({
  imports: [PrismaModule, NginxModule, SslManagerModule],
  providers: [ReloaderService, NginxService, PrismaService, SslManagerService],
  exports: [ReloaderService],
})
export class ReloaderModule {}
