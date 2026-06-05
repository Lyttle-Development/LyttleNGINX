import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentIdentity } from '../auth/decorators/current-identity.decorator';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { AuthIdentity } from '../auth/types/auth-identity';
import { Audit } from '../audit/decorators/audit.decorator';
import { RotateApiKeyDto } from './dto/rotate-api-key.dto';
import { RotateInternalCertsDto } from './dto/rotate-internal-certs.dto';
import { RotatePrivateKeyEncryptionDto } from './dto/rotate-private-key-encryption.dto';
import { SecurityService } from './security.service';

@Controller('security')
@UseGuards(ApiKeyGuard)
@AuthorizeAdmin('security-admin')
export class SecurityController {
  private readonly securityService: SecurityService;

  constructor(securityService: SecurityService) {
    this.securityService = securityService;
  }

  @Get('status')
  @Audit({ action: 'security.status.review' })
  getStatus(@CurrentIdentity() identity: AuthIdentity) {
    return this.securityService.getSecurityStatus(identity);
  }

  @Get('policy')
  @Audit({ action: 'security.policy.review' })
  getPolicy() {
    return this.securityService.getSecurityPolicy();
  }

  @Get('secrets/health')
  @Audit({ action: 'security.secrets.review' })
  getSecretsHealth() {
    return this.securityService.getSecretsHealth();
  }

  @Get('access-review')
  @Audit({ action: 'security.access-review' })
  getAccessReview(@CurrentIdentity() identity: AuthIdentity) {
    return this.securityService.getAccessReview(identity);
  }

  @Post('rotate/api-key')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'security.api-key.rotate.plan' })
  planApiKeyRotation(
    @Body() dto: RotateApiKeyDto,
    @CurrentIdentity() identity: AuthIdentity,
  ) {
    return this.securityService.planApiKeyRotation(identity, dto);
  }

  @Post('rotate/private-key-encryption')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'security.private-key-encryption.rotate' })
  rotatePrivateKeyEncryption(@Body() dto: RotatePrivateKeyEncryptionDto) {
    return this.securityService.rotatePrivateKeyEncryption(dto);
  }

  @Post('rotate/internal-certs')
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('platform-admin')
  @Audit({ action: 'security.internal-certs.rotate' })
  rotateInternalCertificates(@Body() dto: RotateInternalCertsDto) {
    return this.securityService.getInternalCertificateRotationHook(dto);
  }
}
