import { Module } from '@nestjs/common';
import { NginxModule } from '../nginx/nginx.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  imports: [PrismaModule, NginxModule],
  controllers: [ProxyController],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
