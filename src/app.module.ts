import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ReloaderModule } from './reloader/reloader.module';
import { NginxModule } from './nginx/nginx.module';
import { SslModule } from './ssl/ssl.module';
import { AppService } from './app.service';

@Module({
  imports: [PrismaModule, ReloaderModule, NginxModule, SslModule],
  providers: [AppService],
  controllers: [AppController],
})
export class AppModule {}
