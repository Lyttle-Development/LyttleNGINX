import { Module } from '@nestjs/common';
import { NginxService } from './nginx.service';

@Module({
  providers: [NginxService],
  exports: [NginxService],
})
export class NginxModule {}
