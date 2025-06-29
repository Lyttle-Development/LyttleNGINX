import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ReloaderModule } from './reloader/reloader.module';
import { NginxModule } from './nginx/nginx.module';
import { AppService } from './app.service';

@Module({
  imports: [PrismaModule, ReloaderModule, NginxModule],
  providers: [AppService],
  controllers: [AppController],
})
export class AppModule {}
