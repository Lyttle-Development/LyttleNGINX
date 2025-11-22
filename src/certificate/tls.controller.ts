import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { TlsConfigService } from './tls-config.service';

@Controller('tls')
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
  async checkDhParams() {
    const exists = this.tlsConfigService.dhParamsExist();
    return { exists, path: '/etc/nginx/ssl/dhparam.pem' };
  }

  @Post('certificate/info')
  @HttpCode(HttpStatus.OK)
  async getCertificateInfo(@Body() dto: CertificatePemDto) {
    return this.tlsConfigService.getCertificateInfo(dto.certPem);
  }

  @Post('certificate/validate-chain')
  @HttpCode(HttpStatus.OK)
  async validateChain(@Body() dto: ValidateCertChainDto) {
    return this.tlsConfigService.validateCertificateChain(
      dto.certPem,
      dto.chainPem,
    );
  }
}
