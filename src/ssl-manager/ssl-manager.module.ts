import { Module } from '@nestjs/common';
import { SslManagerService } from './ssl-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SslManagerService, PrismaService],
})
export class SslManagerModule {}
