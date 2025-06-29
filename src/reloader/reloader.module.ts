import { Module } from '@nestjs/common';
import { ReloaderService } from './reloader.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NginxModule } from '../nginx/nginx.module';
import { SslModule } from '../ssl/ssl.module';
import { NginxService } from '../nginx/nginx.service';
import { PrismaService } from '../prisma/prisma.service';
import { SslService } from '../ssl/ssl.service';

@Module({
  imports: [PrismaModule, NginxModule, SslModule],
  providers: [ReloaderService, NginxService, PrismaService, SslService],
  exports: [ReloaderService],
})
export class ReloaderModule {}
