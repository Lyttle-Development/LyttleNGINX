import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificateModule } from '../certificate/certificate.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

@Module({
  imports: [AuthModule, CertificateModule],
  controllers: [SecurityController],
  providers: [SecurityService],
})
export class SecurityModule {}
