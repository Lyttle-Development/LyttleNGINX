import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TlsConfigService } from './tls-config.service';
import { CertificatePemDto } from './dto/certificate-pem.dto';
import { ValidateCertChainDto } from './dto/validate-cert-chain.dto';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('tls')
@AuthorizeAdmin('viewer')
export class TlsController {
  constructor(private readonly tlsConfigService: TlsConfigService) {}

  @Get('config/:domain')
  async getRecommendedConfig(@Param('domain') domain: string) {
    return this.tlsConfigService.getRecommendedTlsConfig(domain);
  }

  @Get('test/:domain')
  async testTlsConnection(@Param('domain') domain: string) {
    return this.tlsConfigService.testTlsConnection(domain);
  }

  @Post('dhparam')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthorizeAdmin('security-admin')
  @Audit({ action: 'tls.dhparam.generate' })
  async generateDhParams(@Body() body: { bits?: number }) {
    // Run in background as this can take a long time
    this.tlsConfigService.generateDhParams(body.bits || 2048).catch((err) => {
      console.error('Failed to generate DH params:', err);
    });
    return {
      message: 'DH parameter generation started in background',
      note: 'This may take several minutes',
    };
  }

  @Get('dhparam/status')
  @UseGuards(ApiKeyGuard)
  async checkDhParams() {
    const exists = this.tlsConfigService.dhParamsExist();
    return { exists, path: '/etc/nginx/ssl/dhparam.pem' };
  }

  @Post('certificate/info')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('security-admin')
  @Audit({ action: 'tls.certificate.inspect' })
  async getCertificateInfo(@Body() dto: CertificatePemDto) {
    return this.tlsConfigService.getCertificateInfo(dto.certPem);
  }

  @Post('certificate/validate-chain')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @AuthorizeAdmin('security-admin')
  @Audit({ action: 'tls.certificate.validate-chain' })
  async validateChain(@Body() dto: ValidateCertChainDto) {
    return this.tlsConfigService.validateCertificateChain(
      dto.certPem,
      dto.chainPem,
    );
  }
}
