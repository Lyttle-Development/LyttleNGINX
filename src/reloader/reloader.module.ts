import { Module } from '@nestjs/common';
import { ReloaderService } from './reloader.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NginxModule } from '../nginx/nginx.module';
import { NginxService } from '../nginx/nginx.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [PrismaModule, NginxModule],
  providers: [ReloaderService, NginxService, PrismaService],
  exports: [ReloaderService],
})
export class ReloaderModule {}
