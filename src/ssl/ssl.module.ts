import { Module } from '@nestjs/common';
import { SslService } from './ssl.service';

@Module({
  providers: [SslService],
  exports: [SslService],
})
export class SslModule {}