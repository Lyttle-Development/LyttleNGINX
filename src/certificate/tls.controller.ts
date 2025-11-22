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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-auth.guard';

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
  @UseGuards(OptionalJwtAuthGuard)
  async checkDhParams() {
    const exists = this.tlsConfigService.dhParamsExist();
    return { exists, path: '/etc/nginx/ssl/dhparam.pem' };
  }

  @Post('certificate/info')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getCertificateInfo(@Body() dto: CertificatePemDto) {
    return this.tlsConfigService.getCertificateInfo(dto.certPem);
  }

  @Post('certificate/validate-chain')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async validateChain(@Body() dto: ValidateCertChainDto) {
    return this.tlsConfigService.validateCertificateChain(
      dto.certPem,
      dto.chainPem,
    );
  }
}
