import { Module } from '@nestjs/common';
import { SslManagerService } from './ssl-manager.service';

@Module({
  providers: [SslManagerService],
})
export class SslManagerModule {}
